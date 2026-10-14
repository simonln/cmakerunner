import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../src/models';
import { WorkflowManager } from '../src/services/workflowManager';

describe('workflow manager', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cmakerunner-workflow-'));

  after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const preset: PresetInfo = {
    name: 'debug',
    displayName: 'Debug',
    binaryDir: path.join(tempRoot, 'build', 'debug'),
    sourceDir: '/tmp/src',
    buildPresetName: 'debug-build',
    configuration: 'Debug',
  };

  const target: TargetInfo = {
    id: 'app',
    name: 'app',
    displayName: 'App',
    sourceFiles: ['/tmp/src/main.cpp'],
    guessedExecutablePath: '/tmp/build/debug/app',
  };

  const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  const createDeps = () => {
    const calls: string[] = [];
    const configurationManager = {
      getPresetConfigureCommand: () => 'cmake --preset debug',
      getBuildCommand: () => 'cmake --build /tmp/build/debug --target app',
      getRunCommand: () => '/tmp/build/debug/app',
      resolveDebugProgram: () => '/tmp/build/debug/app',
      createDebugConfiguration: (options: { name: string; program: string; cwd: string; args: string[]; env?: Record<string, string> }) => ({
        name: options.name,
        type: 'cppdbg',
        request: 'launch',
        program: options.program,
        cwd: options.cwd,
        args: options.args,
        env: options.env,
      }),
    };
    const taskExecutionEngine = {
      executeBuild: async () => ({ exitCode: 0 }),
      executeRun: async (_command?: string, _label?: string, _cwd?: string) => ({ exitCode: 0 }),
    };
    const logger = {
      info: (message: string) => calls.push(`info:${message}`),
      warn: (message: string) => calls.push(`warn:${message}`),
      error: (message: string) => calls.push(`error:${message}`),
    };
    const debugSessionManager = {
      startDebugging: (_folder: vscode.WorkspaceFolder | undefined, configuration: vscode.DebugConfiguration) =>
        vscode.debug.startDebugging(_folder, configuration),
    };
    return { calls, configurationManager, taskExecutionEngine, logger, debugSessionManager };
  };

  it('buildPreset returns success and duration on successful configure', async () => {
    const deps = createDeps();
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
    const result = await manager.buildPreset(preset);
    assert.strictEqual(result.succeeded, true);
    assert.ok(result.durationMs >= 0);
  });

  it('buildPreset returns failure and duration on configure failure', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 2 });
    let shown = '';
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      const result = await manager.buildPreset(preset);
      assert.strictEqual(result.succeeded, false);
      assert.ok(result.durationMs >= 0);
      assert.ok(shown.includes('Configure failed'));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('buildTarget runs target when user chooses Run', async () => {
    const deps = createDeps();
    let runCount = 0;
    let shown = '';
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      shown = message;
      return 'Run';
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.buildTarget(preset, target);
      assert.strictEqual(runCount, 1);
      assert.match(shown, /built successfully in \d+(?:\.\d)? (?:ms|s)\./);
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }
  });

  it('buildTarget starts debugger when user chooses Debug', async () => {
    const deps = createDeps();
    let startedConfiguration: Record<string, unknown> | undefined;
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const originalStartDebugging = vscode.debug.startDebugging;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      if (message.includes('built successfully')) {
        return 'Debug';
      }
      return undefined;
    };
    (vscode.debug as any).startDebugging = async (_folder: vscode.WorkspaceFolder, configuration: Record<string, unknown>) => {
      startedConfiguration = configuration;
      return true;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.buildTarget(preset, target);
      assert.deepStrictEqual(startedConfiguration, {
        name: 'Debug App',
        type: 'cppdbg',
        request: 'launch',
        program: '/tmp/build/debug/app',
        cwd: '/tmp/build/debug',
        args: [],
        env: undefined,
      });
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      (vscode.debug as any).startDebugging = originalStartDebugging;
    }
  });

  it('runTarget stops when pre-build fails', async () => {
    const deps = createDeps();
    let runCount = 0;
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 1 });
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
    await manager.runTarget(preset, target, true);
    assert.strictEqual(runCount, 0);
  });

  it('buildTarget shows an error when build fails', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 9 });
    let shown = '';
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.buildTarget(preset, target);
      assert.ok(shown.includes('Build failed'));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('build failure notification offers a terminal action that focuses the terminal', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 7 });
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;
    let offeredActions: readonly string[] = [];
    const executedCommands: string[] = [];
    (vscode.window as any).showErrorMessage = async (_message: string, ...actions: string[]) => {
      offeredActions = actions;
      return 'Show Terminal';
    };
    (vscode.commands as any).executeCommand = async (command: string) => {
      executedCommands.push(command);
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.buildTarget(preset, target);
      await flushAsync();
      assert.deepStrictEqual(offeredActions, ['Show Terminal']);
      assert.ok(executedCommands.includes('workbench.action.terminal.focus'));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });

  it('runTarget reports a failure and offers the terminal action', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeRun = async () => ({ exitCode: 4 });
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;
    let shown = '';
    let offeredActions: readonly string[] = [];
    const executedCommands: string[] = [];
    (vscode.window as any).showErrorMessage = async (message: string, ...actions: string[]) => {
      shown = message;
      offeredActions = actions;
      return 'Show Terminal';
    };
    (vscode.commands as any).executeCommand = async (command: string) => {
      executedCommands.push(command);
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.runTarget(preset, target, false);
      await flushAsync();
      assert.ok(shown.includes('Run failed'));
      assert.deepStrictEqual(offeredActions, ['Show Terminal']);
      assert.ok(executedCommands.includes('workbench.action.terminal.focus'));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });

  it('runTarget stays silent when the run succeeds', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeRun = async () => ({ exitCode: 0 });
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    let errorCount = 0;
    (vscode.window as any).showErrorMessage = async () => {
      errorCount += 1;
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.runTarget(preset, target, false);
      await flushAsync();
      assert.strictEqual(errorCount, 0);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('buildTarget does not report success when the build is cancelled', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 130 });
    let infoCount = 0;
    let shown = '';
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showInformationMessage = async () => {
      infoCount += 1;
      return undefined;
    };
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.buildTarget(preset, target);
      assert.strictEqual(infoCount, 0);
      assert.ok(shown.includes('Build failed'));
      assert.ok(shown.includes('130'));
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('debugTarget shows an error when pre-debug build fails', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 3 });
    let shown = '';
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.debugTarget(preset, target);
      assert.ok(shown.includes('Build failed'));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('runTarget executes directly when buildFirst is false', async () => {
    const deps = createDeps();
    let runCount = 0;
    let runDirectory = '';
    deps.taskExecutionEngine.executeRun = async (_command?: string, _label?: string, cwd?: string) => {
      runCount += 1;
      runDirectory = cwd ?? '';
      return { exitCode: 0 };
    };
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
    await manager.runTarget(preset, target, false);
    assert.strictEqual(runCount, 1);
    assert.strictEqual(runDirectory, preset.binaryDir);
  });

  it('debugTarget starts the debugger directly', async () => {
    const deps = createDeps();
    let startedConfiguration: Record<string, unknown> | undefined;
    const originalStartDebugging = vscode.debug.startDebugging;
    (vscode.debug as any).startDebugging = async (_folder: vscode.WorkspaceFolder, configuration: Record<string, unknown>) => {
      startedConfiguration = configuration;
      return true;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.debugTarget(preset, target);
      assert.deepStrictEqual(startedConfiguration, {
        name: 'Debug App',
        type: 'cppdbg',
        request: 'launch',
        program: '/tmp/build/debug/app',
        cwd: '/tmp/build/debug',
        args: [],
        env: undefined,
      });
    } finally {
      (vscode.debug as any).startDebugging = originalStartDebugging;
    }
  });

  it('debugTarget does not update launch configuration', async () => {
    const deps = createDeps();
    let updated = false;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string, scope?: vscode.Uri) => {
      if (section === 'launch' && scope) {
        return {
          get: () => [],
          update: async () => {
            updated = true;
          },
        };
      }
      return originalGetConfiguration(section as never, scope);
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      await manager.debugTarget(preset, target);
      assert.strictEqual(updated, false);
    } finally {
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    }
  });

  it('buildPreset continues when file api query preparation fails', async () => {
    const deps = createDeps();
    const originalCreateDirectory = vscode.workspace.fs.createDirectory;
    (vscode.workspace.fs as any).createDirectory = async () => {
      throw new Error('mkdir failed');
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never, deps.debugSessionManager as never);
      const result = await manager.buildPreset(preset);
      assert.strictEqual(result.succeeded, true);
      assert.ok(deps.calls.some((call) => call.includes('Unable to prepare CMake File API query')));
    } finally {
      (vscode.workspace.fs as any).createDirectory = originalCreateDirectory;
    }
  });
});
