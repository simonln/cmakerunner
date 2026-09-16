import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { SessionStore } from '../src/app/sessionStore';
import { ConfigurationManager } from '../src/services/configurationManager';
import { DebugSessionManager } from '../src/services/debugSessionManager';
import { OutputLogger } from '../src/services/outputLogger';
import { ProcessResult } from '../src/services/processRunner';
import { GTestTestController, isTestNamedExecutable } from '../src/services/testController';
import { createMockOutputChannel } from './helpers';

interface RecordedEvent {
  readonly type: 'passed' | 'failed' | 'skipped' | 'enqueued' | 'started' | 'end';
  readonly id: string;
  readonly message?: string;
}

describe('test controller', () => {
  describe('isTestNamedExecutable', () => {
    it('accepts executables whose name starts with test in lowercase', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'test_math.exe')), true);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'test_math')), true);
      assert.strictEqual(isTestNamedExecutable('test.exe'), true);
      assert.strictEqual(isTestNamedExecutable('test'), true);
    });

    it('accepts executables whose name starts with test regardless of case', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'TestMath.exe')), true);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'TEST_MATH.exe')), true);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'tEsT-app.exe')), true);
    });

    it('rejects app executables that do not start with test', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'myapp.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'main.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'app')), false);
    });

    it('rejects executables where test appears inside or at the end of the name', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'contest.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'latest.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'mytest.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'test_app_helper.exe')), true);
    });
  });

  describe('run', () => {
    const mockedVscode = vscode as typeof vscode & {
      __mock: {
        readonly createdTestControllers: Map<string, unknown>;
      };
    };
    const fixtureRoot = path.join(os.tmpdir(), `cmakerunner-test-controller-${process.pid}`);
    const executableName = process.platform === 'win32' ? 'test_fake_app.exe' : 'test_fake_app';
    const executablePath = path.join(fixtureRoot, executableName);
    const logger = new OutputLogger(createMockOutputChannel());
    const processRunnerModule = require('../src/services/processRunner') as {
      runProcess: (file: string, args: readonly string[]) => Promise<ProcessResult>;
    };
    const originalRunProcess = processRunnerModule.runProcess;

    const listResult: ProcessResult = {
      exitCode: 0,
      stdout: 'Suite.\n  Case\n',
      stderr: '',
      timedOut: false,
      cancelled: false,
    };

    before(() => {
      fs.mkdirSync(fixtureRoot, { recursive: true });
      fs.writeFileSync(executablePath, '');
    });

    after(() => {
      processRunnerModule.runProcess = originalRunProcess;
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    const createController = async (): Promise<GTestTestController> => {
      const memento = {
        get: () => undefined,
        update: async () => {},
        keys: () => [],
        setKeysForSync: () => {},
      } as unknown as vscode.Memento;
      const store = new SessionStore(memento, logger);
      await store.setPresets([{
        name: 'debug',
        displayName: 'Debug',
        binaryDir: fixtureRoot,
        sourceDir: fixtureRoot,
      }]);
      store.setMapping({
        targets: new Map([[
          'fake',
          {
            id: 'fake',
            name: executableName,
            displayName: executableName,
            type: 'EXECUTABLE',
            sourceFiles: [],
            guessedExecutablePath: executablePath,
          },
        ]]),
        sourceToTargets: new Map(),
      });

      return new GTestTestController(store, new ConfigurationManager(), logger, new DebugSessionManager());
    };

    const createRunRecorder = (events: RecordedEvent[]): vscode.TestRun => ({
      enqueued: (item: vscode.TestItem) => events.push({ type: 'enqueued', id: item.id }),
      started: (item: vscode.TestItem) => events.push({ type: 'started', id: item.id }),
      passed: (item: vscode.TestItem) => events.push({ type: 'passed', id: item.id }),
      failed: (item: vscode.TestItem, message: vscode.TestMessage) => events.push({
        type: 'failed',
        id: item.id,
        message: (message as { message?: string } | undefined)?.message,
      }),
      skipped: (item: vscode.TestItem) => events.push({ type: 'skipped', id: item.id }),
      appendOutput: () => {},
      end: () => events.push({ type: 'end', id: '' }),
    }) as unknown as vscode.TestRun;

    const runSingleCase = async (caseResult: ProcessResult): Promise<RecordedEvent[]> => {
      const events: RecordedEvent[] = [];
      processRunnerModule.runProcess = async (_file, args) => args[0] === '--gtest_list_tests' ? listResult : caseResult;
      const controller = await createController();
      const mockController = mockedVscode.__mock.createdTestControllers.get('cmakerunner.gtests') as {
        createTestRun: () => vscode.TestRun;
      };
      mockController.createTestRun = () => createRunRecorder(events);
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      } as unknown as vscode.CancellationToken;

      await (controller as unknown as {
        run(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void>;
      }).run({ include: undefined, exclude: undefined } as unknown as vscode.TestRunRequest, token);

      return events;
    };

    it('marks a test as passed when the process exits with code 0', async () => {
      const events = await runSingleCase({ exitCode: 0, stdout: '', stderr: '', timedOut: false, cancelled: false });

      assert.deepStrictEqual(events.map((event) => event.type), ['enqueued', 'started', 'passed', 'end']);
    });

    it('marks a test as failed with the process error output', async () => {
      const events = await runSingleCase({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false, cancelled: false });

      const failure = events.find((event) => event.type === 'failed');
      assert.ok(failure?.message?.includes('boom'));
    });

    it('marks a timed out test as failed with the configured timeout', async () => {
      const events = await runSingleCase({ exitCode: undefined, stdout: '', stderr: '', timedOut: true, cancelled: false });

      const failure = events.find((event) => event.type === 'failed');
      assert.ok(failure?.message?.includes('Timed out after 60 s.'));
    });

    it('marks a cancelled test as skipped', async () => {
      const events = await runSingleCase({ exitCode: 1, stdout: '', stderr: '', timedOut: false, cancelled: true });

      assert.ok(events.some((event) => event.type === 'skipped'));
      assert.ok(!events.some((event) => event.type === 'failed'));
    });
  });
});
