import * as assert from 'assert';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../src/models';
import { WorkflowManager } from '../src/services/workflowManager';

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
      resolveDebugProgram: () => '/tmp/build/debug/app',
    };
    const taskExecutionEngine = {
      executeBuild: async () => ({ exitCode: 0 }),
      executeRun: async () => ({ exitCode: 0 }),
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

  it('buildTarget starts debugging when user chooses Debug', async () => {
    const deps = createDeps();
    let debugCount = 0;
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const originalStartDebugging = vscode.debug.startDebugging;
    (vscode.window as any).showInformationMessage = async () => 'Debug';
    (vscode.debug as any).startDebugging = async () => {
      debugCount += 1;
      return true;
    };
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.buildTarget(preset, target);
      assert.strictEqual(debugCount, 1);
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
    deps.taskExecutionEngine.executeRun = async () => {
      runCount += 1;
      return { exitCode: 0 };
    };
    const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
    await manager.runTarget(preset, target, false);
    assert.strictEqual(runCount, 1);
  });

  it('debugTarget warns when debug session does not start', async () => {
    const deps = createDeps();
    let warning = '';
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalStartDebugging = vscode.debug.startDebugging;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warning = message;
      return undefined;
    };
    (vscode.debug as any).startDebugging = async () => false;
    try {
      const manager = new WorkflowManager(deps.configurationManager as never, deps.taskExecutionEngine as never, deps.logger as never);
      await manager.debugTarget(preset, target);
      assert.ok(warning.includes('Unable to start a debug session'));
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
      (vscode.debug as any).startDebugging = originalStartDebugging;
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
