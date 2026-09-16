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
import { GTestTestController, matchesGTestExecutableName } from '../src/services/testController';
import { createMockOutputChannel } from './helpers';

interface RecordedEvent {
  readonly type: 'passed' | 'failed' | 'skipped' | 'enqueued' | 'started' | 'end';
  readonly id: string;
  readonly message?: string;
}

interface TargetDefinition {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

describe('test controller', () => {
  const mockedVscode = vscode as typeof vscode & {
    __mock: {
      readonly createdTestControllers: Map<string, unknown>;
    };
  };
  const fixtureRoot = path.join(os.tmpdir(), `cmakerunner-test-controller-${process.pid}`);
  const executableName = process.platform === 'win32' ? 'test_fake_app.exe' : 'test_fake_app';
  const executablePath = path.join(fixtureRoot, executableName);
  const unitExecutableName = process.platform === 'win32' ? 'unit_math.exe' : 'unit_math';
  const unitExecutablePath = path.join(fixtureRoot, unitExecutableName);
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
    fs.writeFileSync(unitExecutablePath, '');
  });

  after(() => {
    processRunnerModule.runProcess = originalRunProcess;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  const createController = async (options?: {
    readonly patterns?: readonly string[];
    readonly targets?: readonly TargetDefinition[];
  }): Promise<GTestTestController> => {
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
    const targetDefinitions = options?.targets ?? [{ id: 'fake', name: executableName, path: executablePath }];
    store.setMapping({
      targets: new Map(targetDefinitions.map((definition) => [definition.id, {
        id: definition.id,
        name: definition.name,
        displayName: definition.name,
        type: 'EXECUTABLE',
        sourceFiles: [],
        guessedExecutablePath: definition.path,
      }])),
      sourceToTargets: new Map(),
    });

    const configurationManager = new ConfigurationManager();
    if (options?.patterns) {
      (configurationManager as unknown as { getGTestExecutablePatterns: () => readonly string[] })
        .getGTestExecutablePatterns = () => options.patterns as readonly string[];
    }

    return new GTestTestController(store, configurationManager, logger, new DebugSessionManager());
  };

  describe('matchesGTestExecutableName', () => {
    it('matches the default test prefix case-insensitively', () => {
      const patterns = ['test*'];
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'test_math.exe'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'test_math'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName('test.exe', patterns), true);
      assert.strictEqual(matchesGTestExecutableName('test', patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'TestMath.exe'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'TEST_MATH.exe'), patterns), true);
    });

    it('rejects executables that do not match the pattern', () => {
      const patterns = ['test*'];
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'myapp.exe'), patterns), false);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'latest.exe'), patterns), false);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'contest.exe'), patterns), false);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'mytest.exe'), patterns), false);
    });

    it('matches suffix patterns', () => {
      const patterns = ['*_test', '*_tests', '*-test'];
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'math_test'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'core_tests'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'math-test.exe'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'math'), patterns), false);
    });

    it('treats patterns containing uppercase as case-sensitive', () => {
      const patterns = ['*Test'];
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'MathTest.exe'), patterns), true);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'latest.exe'), patterns), false);
      assert.strictEqual(matchesGTestExecutableName(path.join('build', 'contest.exe'), patterns), false);
    });

    it('supports the question mark wildcard', () => {
      const patterns = ['test?'];
      assert.strictEqual(matchesGTestExecutableName('test1', patterns), true);
      assert.strictEqual(matchesGTestExecutableName('test12', patterns), false);
    });

    it('returns false when no pattern matches', () => {
      assert.strictEqual(matchesGTestExecutableName('test_math', []), false);
    });
  });

  describe('discover', () => {
    it('probes only executables matching the default test prefix', async () => {
      const probed: string[] = [];
      processRunnerModule.runProcess = async (file) => {
        probed.push(file);
        return listResult;
      };
      const controller = await createController({
        targets: [
          { id: 'named', name: executableName, path: executablePath },
          { id: 'unit', name: unitExecutableName, path: unitExecutablePath },
        ],
      });

      await controller.discover();

      assert.deepStrictEqual(probed, [executablePath]);
    });

    it('probes executables matching configured patterns instead of the default', async () => {
      const probed: string[] = [];
      processRunnerModule.runProcess = async (file) => {
        probed.push(file);
        return listResult;
      };
      const controller = await createController({
        patterns: ['unit_*'],
        targets: [
          { id: 'named', name: executableName, path: executablePath },
          { id: 'unit', name: unitExecutableName, path: unitExecutablePath },
        ],
      });

      await controller.discover();

      assert.deepStrictEqual(probed, [unitExecutablePath]);
    });
  });

  describe('run', () => {
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
