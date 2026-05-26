import * as assert from 'assert';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../src/models';
import { parseGTestListOutput, WorkflowManager } from '../src/services/workflowManager';

const childProcess = require('child_process') as typeof import('child_process');

describe('workflow manager', () => {
  const preset: PresetInfo = {
    name: 'debug',
    displayName: 'Debug',
    binaryDir: '/tmp/build/debug',
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

  const createDeps = () => {
    const calls: string[] = [];
    const configurationManager = {
      getPresetConfigureCommand: () => 'cmake --preset debug',
      getBuildCommand: () => 'cmake --build /tmp/build/debug --target app',
      getRunCommand: () => '/tmp/build/debug/app',
      getDebugType: () => 'cppdbg',
      resolveDebugProgram: () => '/tmp/build/debug/app',
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
    return { calls, configurationManager, taskExecutionEngine, logger };
  };

  it('buildPreset returns true on successful configure', async () => {
    const deps = createDeps();
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
    const result = await manager.buildPreset(preset);
    assert.strictEqual(result, true);
  });

  it('buildPreset returns false on configure failure', async () => {
    const deps = createDeps();
    deps.taskExecutionEngine.executeBuild = async () => ({ exitCode: 2 });
    let shown = '';
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      const result = await manager.buildPreset(preset);
      assert.strictEqual(result, false);
      assert.ok(shown.includes('Configure failed'));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('buildTarget runs target when user chooses Run', async () => {
    const deps = createDeps();
    let runCount = 0;
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => 'Run';
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.buildTarget(preset, target);
      assert.strictEqual(runCount, 1);
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }
  });

  it('buildTarget updates launch configuration when user chooses Debug', async () => {
    const deps = createDeps();
    let updatedConfigurations: Record<string, unknown>[] = [];
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      if (message.includes('built successfully')) {
        return 'Debug';
      }
      return undefined;
    };
    (vscode.workspace as any).getConfiguration = (section?: string, scope?: vscode.Uri) => {
      if (section === 'launch' && scope) {
        return {
          get: () => [],
          update: async (_key: string, value: Record<string, unknown>[]) => {
            updatedConfigurations = value;
          },
        };
      }
      return originalGetConfiguration(section as never, scope);
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.buildTarget(preset, target);
      assert.strictEqual(updatedConfigurations.length, 1);
      assert.deepStrictEqual(updatedConfigurations[0], {
        name: 'Debug App',
        type: 'cppdbg',
        expressions: undefined,
        request: 'launch',
        program: '/tmp/build/debug/app',
        cwd: '/tmp/build/debug',
        args: [],
      });
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
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
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
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
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.buildTarget(preset, target);
      assert.ok(shown.includes('Build failed'));
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
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
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
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
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
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
    await manager.runTarget(preset, target, false);
    assert.strictEqual(runCount, 1);
    assert.strictEqual(runDirectory, preset.binaryDir);
  });

  it('parseGTestListOutput parses suites, tests, and comments', () => {
    const parsed = parseGTestListOutput([
      'MathTest.',
      '  Adds',
      '  Divides # GetParam() = 1',
      'TypedSuite/0.  # TypeParam = int',
      '  Works',
    ].join('\n'));

    assert.deepStrictEqual(parsed, [
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      { suite: 'MathTest', name: 'Divides', filter: 'MathTest.Divides' },
      { suite: 'TypedSuite/0', name: 'Works', filter: 'TypedSuite/0.Works' },
    ]);
  });

  it('runGTestCase lists cases and runs the selected filter', async () => {
    const deps = createDeps();
    let runCommand = '';
    deps.taskExecutionEngine.executeRun = async (command?: string) => {
      runCommand = command ?? '';
      return { exitCode: 0 };
    };

    const originalExecFile = childProcess.execFile;
    const originalShowQuickPick = vscode.window.showQuickPick;
    (childProcess as any).execFile = (_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(undefined, 'SuiteA.\n  TestOne\n  TestTwo\n', '');
      return {} as ChildProcess;
    };
    (vscode.window as any).showQuickPick = async (items: readonly { label: string }[]) => items[1];

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runGTestCase(preset, target, false);
      assert.strictEqual(runCommand, '/tmp/build/debug/app --gtest_filter=SuiteA.TestTwo');
    } finally {
      (childProcess as any).execFile = originalExecFile;
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  it('runGTestCase shows a warning and does not run when no cases are discovered', async () => {
    const deps = createDeps();
    let warned = '';
    let runCount = 0;
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };

    const originalExecFile = childProcess.execFile;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (childProcess as any).execFile = (_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(undefined, '', '');
      return {} as ChildProcess;
    };
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warned = message;
      return undefined;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runGTestCase(preset, target, false);
      assert.ok(warned.includes('No GoogleTest cases were found'));
      assert.strictEqual(runCount, 0);
    } finally {
      (childProcess as any).execFile = originalExecFile;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('runGTestCase stops when the user cancels case selection', async () => {
    const deps = createDeps();
    let runCount = 0;
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };

    const originalExecFile = childProcess.execFile;
    const originalShowQuickPick = vscode.window.showQuickPick;
    (childProcess as any).execFile = (_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(undefined, 'SuiteA.\n  TestOne\n', '');
      return {} as ChildProcess;
    };
    (vscode.window as any).showQuickPick = async () => undefined;

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runGTestCase(preset, target, false);
      assert.strictEqual(runCount, 0);
    } finally {
      (childProcess as any).execFile = originalExecFile;
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  it('runGTestCases runs selected cases separately', async () => {
    const deps = createDeps();
    const runCommands: string[] = [];
    const runLabels: string[] = [];
    deps.taskExecutionEngine.executeRun = async (command?: string, label?: string) => {
      runCommands.push(command ?? '');
      runLabels.push(label ?? '');
      return { exitCode: 0 };
    };

    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
    await manager.runGTestCases(preset, target, [
      { suite: 'SuiteA', name: 'TestOne', filter: 'SuiteA.TestOne' },
      { suite: 'SuiteA', name: 'TestTwo', filter: 'SuiteA.TestTwo' },
    ], false);

    assert.deepStrictEqual(runCommands, [
      '/tmp/build/debug/app --gtest_filter=SuiteA.TestOne',
      '/tmp/build/debug/app --gtest_filter=SuiteA.TestTwo',
    ]);
    assert.deepStrictEqual(runLabels, [
      'Run SuiteA.TestOne (1/2) [debug]',
      'Run SuiteA.TestTwo (2/2) [debug]',
    ]);
  });

  it('runGTestCases continues remaining cases after failures', async () => {
    const deps = createDeps();
    const runCommands: string[] = [];
    const exitCodes = [1, 0, 2];
    deps.taskExecutionEngine.executeRun = async (command?: string) => {
      runCommands.push(command ?? '');
      return { exitCode: exitCodes.shift() ?? 0 };
    };

    let shown = '';
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runGTestCases(preset, target, [
        { suite: 'SuiteA', name: 'TestOne', filter: 'SuiteA.TestOne' },
        { suite: 'SuiteA', name: 'TestTwo', filter: 'SuiteA.TestTwo' },
        { suite: 'SuiteA', name: 'TestThree', filter: 'SuiteA.TestThree' },
      ], false);

      assert.deepStrictEqual(runCommands, [
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestOne',
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestTwo',
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestThree',
      ]);
      assert.ok(shown.includes('2 of 3 GoogleTest cases failed'));
      assert.ok(deps.calls.some((call) => call.includes('continuing with remaining cases')));
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('runGTestCases does not run when no cases are selected', async () => {
    const deps = createDeps();
    let warned = '';
    let runCount = 0;
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warned = message;
      return undefined;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runGTestCases(preset, target, [], false);
      assert.ok(warned.includes('No GoogleTest cases were selected'));
      assert.strictEqual(runCount, 0);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('runAllGTestCases runs discovered cases separately', async () => {
    const deps = createDeps();
    const runCommands: string[] = [];
    deps.taskExecutionEngine.executeRun = async (command?: string) => {
      runCommands.push(command ?? '');
      return { exitCode: 0 };
    };

    const originalExecFile = childProcess.execFile;
    (childProcess as any).execFile = (_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(undefined, 'SuiteA.\n  TestOne\n  TestTwo\n', '');
      return {} as ChildProcess;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runAllGTestCases(preset, target, false);
      assert.deepStrictEqual(runCommands, [
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestOne',
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestTwo',
      ]);
    } finally {
      (childProcess as any).execFile = originalExecFile;
    }
  });

  it('runAllGTestCases continues after a discovered case fails', async () => {
    const deps = createDeps();
    const runCommands: string[] = [];
    const exitCodes = [0, 1, 0];
    deps.taskExecutionEngine.executeRun = async (command?: string) => {
      runCommands.push(command ?? '');
      return { exitCode: exitCodes.shift() ?? 0 };
    };

    const originalExecFile = childProcess.execFile;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    let shown = '';
    (childProcess as any).execFile = (_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(undefined, 'SuiteA.\n  TestOne\n  TestTwo\n  TestThree\n', '');
      return {} as ChildProcess;
    };
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.runAllGTestCases(preset, target, false);
      assert.deepStrictEqual(runCommands, [
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestOne',
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestTwo',
        '/tmp/build/debug/app --gtest_filter=SuiteA.TestThree',
      ]);
      assert.ok(shown.includes('1 of 3 GoogleTest cases failed'));
    } finally {
      (childProcess as any).execFile = originalExecFile;
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('debugGTestCase writes launch configuration and starts the selected test case', async () => {
    const deps = createDeps();
    deps.configurationManager.getDebugType = () => 'lldb';
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cmakerunner-workflow-'));
    const existingConfiguration = {
      name: 'Keep Me',
      type: 'cppdbg',
      request: 'launch',
      program: '/tmp/keep',
    };
    let updatedConfigurations: Record<string, unknown>[] = [];
    let startedConfiguration: Record<string, unknown> | undefined;

    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    const originalStartDebugging = vscode.debug.startDebugging;

    (vscode.workspace as { workspaceFolders?: typeof vscode.workspace.workspaceFolders }).workspaceFolders = [
      { uri: { fsPath: tempRoot } } as unknown as vscode.WorkspaceFolder,
    ];
    (vscode.workspace as any).getConfiguration = (section?: string, scope?: vscode.Uri) => {
      if (section === 'launch' && scope) {
        return {
          get: () => [existingConfiguration],
          update: async (_key: string, value: Record<string, unknown>[]) => {
            updatedConfigurations = value;
          },
        };
      }
      return originalGetConfiguration(section as never, scope);
    };
    (vscode.debug as any).startDebugging = async (_folder: vscode.WorkspaceFolder, configuration: Record<string, unknown>) => {
      startedConfiguration = configuration;
      return true;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.debugGTestCase(preset, target, { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' }, false);
    } finally {
      (vscode.workspace as { workspaceFolders?: typeof vscode.workspace.workspaceFolders }).workspaceFolders = originalWorkspaceFolders;
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
      (vscode.debug as any).startDebugging = originalStartDebugging;
    }

    try {
      assert.ok(fs.existsSync(path.join(tempRoot, '.vscode', 'launch.json')));
      assert.strictEqual(updatedConfigurations.length, 2);
      assert.deepStrictEqual(updatedConfigurations[0], existingConfiguration);
      assert.deepStrictEqual(updatedConfigurations[1], {
        name: 'Debug MathTest.Adds',
        type: 'lldb',
        expressions: 'native',
        request: 'launch',
        program: '/tmp/build/debug/app',
        cwd: '/tmp/build/debug',
        args: ['--gtest_filter=MathTest.Adds'],
        env: {
          ASAN_OPTIONS: 'detect_leaks=0',
          LSAN_OPTIONS: 'detect_leaks=0',
        },
      });
      assert.deepStrictEqual(startedConfiguration, updatedConfigurations[1]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('listGTestCases shows an error when gtest discovery fails', async () => {
    const deps = createDeps();
    let shown = '';

    const originalExecFile = childProcess.execFile;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (childProcess as any).execFile = (_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(new Error('spawn failed'), '', 'permission denied');
      return {} as ChildProcess;
    };
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown = message;
      return undefined;
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      const result = await manager.listGTestCases(preset, target);
      assert.strictEqual(result, undefined);
      assert.ok(shown.includes('Unable to list GoogleTest cases'));
      assert.ok(shown.includes('permission denied'));
    } finally {
      (childProcess as any).execFile = originalExecFile;
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('debugTarget opens Run and Debug when requested after writing launch configuration', async () => {
    const deps = createDeps();
    let executedCommand = '';
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.window as any).showInformationMessage = async () => 'Open Run and Debug';
    (vscode.commands as any).executeCommand = async (command: string) => {
      executedCommand = command;
      return undefined;
    };
    (vscode.workspace as any).getConfiguration = (section?: string, scope?: vscode.Uri) => {
      if (section === 'launch' && scope) {
        return {
          get: () => [],
          update: async () => undefined,
        };
      }
      return originalGetConfiguration(section as never, scope);
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.debugTarget(preset, target);
      assert.strictEqual(executedCommand, 'workbench.view.debug');
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      (vscode.commands as any).executeCommand = originalExecuteCommand;
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    }
  });

  it('debugTarget keeps existing launch configuration when overwrite is not confirmed', async () => {
    const deps = createDeps();
    let updated = false;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    const existingConfigurations = [{
      name: 'Debug App',
      type: 'cppdbg',
      request: 'launch',
      program: '/tmp/build/debug/app',
      cwd: '/tmp/build/debug',
      args: [],
    }];

    (vscode.window as any).showWarningMessage = async (message: string) => {
      if (message.includes('launch.json already contains')) {
        return undefined;
      }
      return undefined;
    };
    (vscode.workspace as any).getConfiguration = (section?: string, scope?: vscode.Uri) => {
      if (section === 'launch' && scope) {
        return {
          get: () => existingConfigurations,
          update: async () => {
            updated = true;
          },
        };
      }
      return originalGetConfiguration(section as never, scope);
    };

    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.debugTarget(preset, target);
      assert.strictEqual(updated, false);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
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
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      const result = await manager.buildPreset(preset);
      assert.strictEqual(result, true);
      assert.ok(deps.calls.some((call) => call.includes('Unable to prepare CMake File API query')));
    } finally {
      (vscode.workspace.fs as any).createDirectory = originalCreateDirectory;
    }
  });
});
