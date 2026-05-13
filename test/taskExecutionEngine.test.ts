import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

describe('task execution engine', () => {
  const loadTaskExecutionEngineModule = () => {
    const modulePath = require.resolve('../src/services/taskExecutionEngine');
    delete require.cache[modulePath];
    return require('../src/services/taskExecutionEngine') as typeof import('../src/services/taskExecutionEngine');
  };

  const setPlatform = (platform: NodeJS.Platform): (() => void) => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });
    return () => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    };
  };

  const createEngine = () => {
    const configurationManager = {
      shouldClearTerminalBeforeRun: () => true,
    };
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const { TaskExecutionEngine } = loadTaskExecutionEngineModule();
    return new TaskExecutionEngine('/workspace', configurationManager as never, logger as never);
  };

  it('executeBuild creates a build task and resolves process exit codes', async () => {
    const originalExecuteTask = vscode.tasks.executeTask;
    const originalOnDidEndTaskProcess = vscode.tasks.onDidEndTaskProcess;
    const originalOnDidEndTask = vscode.tasks.onDidEndTask;

    const execution = { id: 'build-execution' };
    let capturedTask: vscode.Task | undefined;
    let processListener: ((event: { execution: unknown; exitCode: number | undefined }) => void) | undefined;
    let taskListener: ((event: { execution: unknown }) => void) | undefined;

    (vscode.tasks as any).executeTask = async (task: vscode.Task) => {
      capturedTask = task;
      return execution;
    };
    (vscode.tasks as any).onDidEndTaskProcess = (listener: typeof processListener) => {
      processListener = listener;
      return { dispose: () => {} };
    };
    (vscode.tasks as any).onDidEndTask = (listener: typeof taskListener) => {
      taskListener = listener;
      return { dispose: () => {} };
    };

    try {
      const engine = createEngine();
      const resultPromise = engine.executeBuild('cmake --build build --target app', 'Build app', vscode.TaskRevealKind.Never);
      await Promise.resolve();
      processListener?.({ execution, exitCode: 7 });
      const result = await resultPromise;

      assert.strictEqual(result.exitCode, 7);
      assert.ok(capturedTask);
      assert.strictEqual(capturedTask?.name, 'Build app');
      assert.strictEqual(capturedTask?.group, vscode.TaskGroup.Build);
      assert.deepStrictEqual(capturedTask?.problemMatchers, ['$gcc', '$msCompile']);
      assert.strictEqual(capturedTask?.presentationOptions?.reveal, vscode.TaskRevealKind.Never);
      assert.strictEqual(capturedTask?.presentationOptions?.clear, true);
      assert.strictEqual((capturedTask?.execution as any)?.command, 'cmake --build build --target app');
      assert.ok(taskListener);
    } finally {
      (vscode.tasks as any).executeTask = originalExecuteTask;
      (vscode.tasks as any).onDidEndTaskProcess = originalOnDidEndTaskProcess;
      (vscode.tasks as any).onDidEndTask = originalOnDidEndTask;
    }
  });

  it('executeRun resolves when the task ends without a process exit code and wraps the working directory on Windows', async () => {
    const restorePlatform = setPlatform('win32');
    const originalExecuteTask = vscode.tasks.executeTask;
    const originalOnDidEndTaskProcess = vscode.tasks.onDidEndTaskProcess;
    const originalOnDidEndTask = vscode.tasks.onDidEndTask;

    const execution = { id: 'run-execution' };
    let capturedTask: vscode.Task | undefined;
    let taskListener: ((event: { execution: unknown }) => void) | undefined;

    (vscode.tasks as any).executeTask = async (task: vscode.Task) => {
      capturedTask = task;
      return execution;
    };
    (vscode.tasks as any).onDidEndTaskProcess = () => ({ dispose: () => {} });
    (vscode.tasks as any).onDidEndTask = (listener: typeof taskListener) => {
      taskListener = listener;
      return { dispose: () => {} };
    };

    try {
      const engine = createEngine();
      const resultPromise = engine.executeRun('& "C:/tools/my app.exe"', 'Run app', 'C:/work dir');
      await Promise.resolve();
      taskListener?.({ execution });
      const result = await resultPromise;

      assert.strictEqual(result.exitCode, undefined);
      assert.ok(capturedTask);
      assert.deepStrictEqual(capturedTask?.problemMatchers, []);
      assert.ok(String((capturedTask?.execution as any)?.command).includes("Push-Location 'C:/work dir'"));
      assert.ok(String((capturedTask?.execution as any)?.command).includes('& "C:/tools/my app.exe"'));
    } finally {
      restorePlatform();
      (vscode.tasks as any).executeTask = originalExecuteTask;
      (vscode.tasks as any).onDidEndTaskProcess = originalOnDidEndTaskProcess;
      (vscode.tasks as any).onDidEndTask = originalOnDidEndTask;
    }
  });

  it('wraps cmake build commands with vcvarsall when VSINSTALLDIR is available on Windows', async () => {
    const restorePlatform = setPlatform('win32');
    const originalExecuteTask = vscode.tasks.executeTask;
    const originalOnDidEndTaskProcess = vscode.tasks.onDidEndTaskProcess;
    const originalOnDidEndTask = vscode.tasks.onDidEndTask;
    const originalVsInstallDir = process.env.VSINSTALLDIR;

    const fakeVsRoot = path.join(__dirname, 'fixtures', 'fake-vs');
    const vcvarsallPath = path.join(fakeVsRoot, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
    fs.mkdirSync(path.dirname(vcvarsallPath), { recursive: true });
    fs.writeFileSync(vcvarsallPath, '@echo off\n');
    process.env.VSINSTALLDIR = fakeVsRoot;

    const execution = { id: 'wrapped-build' };
    let capturedTask: vscode.Task | undefined;
    let processListener: ((event: { execution: unknown; exitCode: number | undefined }) => void) | undefined;

    (vscode.tasks as any).executeTask = async (task: vscode.Task) => {
      capturedTask = task;
      return execution;
    };
    (vscode.tasks as any).onDidEndTaskProcess = (listener: typeof processListener) => {
      processListener = listener;
      return { dispose: () => {} };
    };
    (vscode.tasks as any).onDidEndTask = () => ({ dispose: () => {} });

    try {
      const engine = createEngine();
      const resultPromise = engine.executeBuild('cmake --preset debug', 'Configure [debug]');
      await Promise.resolve();
      processListener?.({ execution, exitCode: 0 });
      await resultPromise;

      assert.strictEqual((capturedTask?.execution as any)?.options?.executable, process.env.comspec ?? 'cmd.exe');
      assert.deepStrictEqual((capturedTask?.execution as any)?.options?.shellArgs, ['/d', '/s', '/c']);
      assert.ok(String((capturedTask?.execution as any)?.command).includes(`call "${vcvarsallPath}" x64 >nul 2>&1 && cmake --preset debug`));
    } finally {
      if (originalVsInstallDir === undefined) {
        delete process.env.VSINSTALLDIR;
      } else {
        process.env.VSINSTALLDIR = originalVsInstallDir;
      }
      restorePlatform();
      (vscode.tasks as any).executeTask = originalExecuteTask;
      (vscode.tasks as any).onDidEndTaskProcess = originalOnDidEndTaskProcess;
      (vscode.tasks as any).onDidEndTask = originalOnDidEndTask;
    }
  });

  it('runs cmake build commands through cmd.exe on Windows without vcvarsall', async () => {
    const restorePlatform = setPlatform('win32');
    const originalExecuteTask = vscode.tasks.executeTask;
    const originalOnDidEndTaskProcess = vscode.tasks.onDidEndTaskProcess;
    const originalOnDidEndTask = vscode.tasks.onDidEndTask;
    const originalVsInstallDir = process.env.VSINSTALLDIR;

    delete process.env.VSINSTALLDIR;

    const execution = { id: 'plain-cmake-build' };
    let capturedTask: vscode.Task | undefined;
    let processListener: ((event: { execution: unknown; exitCode: number | undefined }) => void) | undefined;

    (vscode.tasks as any).executeTask = async (task: vscode.Task) => {
      capturedTask = task;
      return execution;
    };
    (vscode.tasks as any).onDidEndTaskProcess = (listener: typeof processListener) => {
      processListener = listener;
      return { dispose: () => {} };
    };
    (vscode.tasks as any).onDidEndTask = () => ({ dispose: () => {} });

    try {
      const engine = createEngine();
      const resultPromise = engine.executeBuild('cmake --build build --target app', 'Build app');
      await Promise.resolve();
      processListener?.({ execution, exitCode: 0 });
      await resultPromise;

      assert.strictEqual((capturedTask?.execution as any)?.options?.executable, process.env.comspec ?? 'cmd.exe');
      assert.deepStrictEqual((capturedTask?.execution as any)?.options?.shellArgs, ['/d', '/s', '/c']);
      assert.strictEqual((capturedTask?.execution as any)?.command, 'cmake --build build --target app');
    } finally {
      if (originalVsInstallDir === undefined) {
        delete process.env.VSINSTALLDIR;
      } else {
        process.env.VSINSTALLDIR = originalVsInstallDir;
      }
      restorePlatform();
      (vscode.tasks as any).executeTask = originalExecuteTask;
      (vscode.tasks as any).onDidEndTaskProcess = originalOnDidEndTaskProcess;
      (vscode.tasks as any).onDidEndTask = originalOnDidEndTask;
    }
  });
});
