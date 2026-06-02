import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TargetTreeItem } from '../src/ui/targetTreeDataProvider';

type MockVscode = typeof vscode & {
  __mock: {
    readonly registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    readonly createdTreeViews: Map<string, {
      description?: string;
      message?: string;
      options?: {
        treeDataProvider?: unknown;
      };
    }>;
    readonly createdTestControllers: Map<string, unknown>;
    setQuickPickController(controller: ((quickPick: {
      readonly items: readonly vscode.QuickPickItem[];
      selectedItems: readonly vscode.QuickPickItem[];
      activeItems: readonly vscode.QuickPickItem[];
    }, controls: {
      changeValue(value: string): void;
      accept(): void;
      hide(): void;
    }) => void) | undefined): void;
    reset(): void;
  };
};

describe('extension commands', () => {
  const mockedVscode = vscode as MockVscode;
  const fixtureRoot = path.join(__dirname, 'fixtures', 'workspace-extension');
  const sourceDir = path.join(fixtureRoot, 'src');
  const buildReplyDir = path.join(fixtureRoot, 'build', 'debug', '.cmake', 'api', 'v1', 'reply');
  const commonSourcePath = path.join(sourceDir, 'common.cpp');
  const appSourcePath = path.join(sourceDir, 'app.cpp');
  const demoSourcePath = path.join(sourceDir, 'demo.cpp');
  const helperSourcePath = path.join(sourceDir, 'helper.cpp');

  const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;
  const originalShowTextDocument = vscode.window.showTextDocument;

  type MockQuickPick = {
    readonly items: readonly vscode.QuickPickItem[];
    selectedItems: readonly vscode.QuickPickItem[];
    activeItems: readonly vscode.QuickPickItem[];
  };

  const setQuickPickItemSelection = (
    label: string,
    onItems?: (items: readonly vscode.QuickPickItem[]) => void,
  ): void => {
    mockedVscode.__mock.setQuickPickController((quickPick: MockQuickPick, controls) => {
      onItems?.(quickPick.items);
      const item = quickPick.items.find((candidate) => candidate.label === label);
      (quickPick as { selectedItems: readonly vscode.QuickPickItem[] }).selectedItems = item ? [item] : [];
      (quickPick as { activeItems: readonly vscode.QuickPickItem[] }).activeItems = item ? [item] : [];
      controls.accept();
    });
  };

  const captureQuickPickItems = (onItems: (items: readonly vscode.QuickPickItem[]) => void): void => {
    mockedVscode.__mock.setQuickPickController((quickPick: MockQuickPick, controls) => {
      onItems(quickPick.items);
      controls.hide();
    });
  };

  const setRegexQuickPickInput = (value: string): void => {
    mockedVscode.__mock.setQuickPickController((quickPick: MockQuickPick, controls) => {
      controls.changeValue(value);
      (quickPick as { selectedItems: readonly vscode.QuickPickItem[] }).selectedItems = [];
      (quickPick as { activeItems: readonly vscode.QuickPickItem[] }).activeItems = [quickPick.items[0]];
      controls.accept();
    });
  };

  before(() => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(buildReplyDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureRoot, 'CMakePresets.json'), JSON.stringify({
      version: 3,
      configurePresets: [
        {
          name: 'debug',
          displayName: 'Debug',
          binaryDir: '${sourceDir}/build/debug',
        },
      ],
    }, null, 2));

    for (const filePath of [commonSourcePath, appSourcePath, demoSourcePath, helperSourcePath]) {
      fs.writeFileSync(filePath, '// fixture\n');
    }

    fs.writeFileSync(path.join(buildReplyDir, 'index-001.json'), JSON.stringify({
      objects: [{ kind: 'codemodel', jsonFile: 'codemodel-v2.json' }],
    }, null, 2));
    fs.writeFileSync(path.join(buildReplyDir, 'codemodel-v2.json'), JSON.stringify({
      configurations: [
        {
          name: 'Debug',
          targets: [
            { name: 'app', id: 'app', jsonFile: 'target-app.json' },
            { name: 'demo', id: 'demo', jsonFile: 'target-demo.json' },
            { name: 'helper', id: 'helper', jsonFile: 'target-helper.json' },
          ],
        },
      ],
    }, null, 2));
    fs.writeFileSync(path.join(buildReplyDir, 'target-app.json'), JSON.stringify({
      name: 'app',
      type: 'EXECUTABLE',
      artifacts: [{ path: path.join(fixtureRoot, 'bin', 'app') }],
      sources: [{ path: commonSourcePath }, { path: appSourcePath }],
    }, null, 2));
    fs.writeFileSync(path.join(buildReplyDir, 'target-demo.json'), JSON.stringify({
      name: 'demo',
      type: 'EXECUTABLE',
      artifacts: [{ path: path.join(fixtureRoot, 'bin', 'demo') }],
      sources: [{ path: commonSourcePath }, { path: demoSourcePath }],
    }, null, 2));
    fs.writeFileSync(path.join(buildReplyDir, 'target-helper.json'), JSON.stringify({
      name: 'helper',
      type: 'EXECUTABLE',
      artifacts: [{ path: path.join(fixtureRoot, 'bin', 'helper') }],
      sources: [{ path: helperSourcePath }],
    }, null, 2));
  });

  beforeEach(() => {
    mockedVscode.__mock.reset();
    (vscode.workspace as { workspaceFolders?: typeof vscode.workspace.workspaceFolders }).workspaceFolders = [
      { uri: { fsPath: fixtureRoot } } as unknown as vscode.WorkspaceFolder,
    ];
    (vscode.window as { activeTextEditor?: vscode.TextEditor }).activeTextEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: commonSourcePath,
        },
      },
    } as unknown as vscode.TextEditor;
    (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = async () => undefined;
  });

  afterEach(() => {
    (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
    (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = originalShowInputBox;
    (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument = originalShowTextDocument;
    (vscode.workspace as { workspaceFolders?: typeof vscode.workspace.workspaceFolders }).workspaceFolders = originalWorkspaceFolders;
  });

  const activateExtension = async (): Promise<void> => {
    const extensionModulePath = require.resolve('../src/extension');
    delete require.cache[extensionModulePath];
    const { activate } = require('../src/extension') as typeof import('../src/extension');
    const workspaceState = new Map<string, string>();
    await activate({
      subscriptions: [],
      workspaceState: {
        get: (key: string) => workspaceState.get(key),
        update: async (key: string, value: string) => {
          workspaceState.set(key, value);
        },
      },
    } as unknown as vscode.ExtensionContext);
  };

  it('buildTargetFromCurrentFile shows only targets mapped from the active file and builds the selected one', async () => {
    await activateExtension();

    const pickedLabels: string[] = [];
    let builtTargetName: string | undefined;
    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildTarget = workflowModule.WorkflowManager.prototype.buildTarget;
    workflowModule.WorkflowManager.prototype.buildTarget = async (_preset, target) => {
      builtTargetName = target.name;
    };
    (vscode.window as any).showQuickPick = async (items: readonly { label: string }[]) => {
      const quickPickItems = items as Array<{ label: string }>;
      pickedLabels.push(...quickPickItems.map((item) => item.label));
      return items?.[1];
    };

    try {
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
    } finally {
      workflowModule.WorkflowManager.prototype.buildTarget = originalBuildTarget;
    }

    assert.deepStrictEqual(pickedLabels, ['app', 'demo']);
    assert.strictEqual(builtTargetName, 'demo');
  });

  it('filterTargets reuses the auto-filtered target list and applies the selected target as the tree filter', async () => {
    await activateExtension();

    const pickedLabels: string[] = [];
    setQuickPickItemSelection('demo', (items) => {
      pickedLabels.push(...items.map((item) => item.label));
    });

    await vscode.commands.executeCommand('cmakerunner.filterTargets');

    const targetsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.targets');
    assert.ok(targetsTreeView);
    assert.deepStrictEqual(pickedLabels, ['app', 'demo', 'helper']);
    assert.strictEqual(targetsTreeView?.description, 'Filter: demo');
  });

  it('filterTargets exposes source file paths in quick pick details for search', async () => {
    await activateExtension();

    const pickedItems: Array<{ label: string; detail?: string }> = [];
    captureQuickPickItems((items) => {
      pickedItems.push(...items as Array<{ label: string; detail?: string }>);
    });

    await vscode.commands.executeCommand('cmakerunner.filterTargets');

    const appItem = pickedItems.find((item) => item.label === 'app');
    const demoItem = pickedItems.find((item) => item.label === 'demo');
    assert.ok(appItem?.detail?.includes(path.join('src', 'app.cpp')));
    assert.ok(demoItem?.detail?.includes(path.join('src', 'demo.cpp')));
    assert.ok(appItem?.detail?.includes(path.join('src', 'common.cpp')));
  });

  it('filterTargets applies typed regular expressions to all matching targets', async () => {
    await activateExtension();

    setRegexQuickPickInput('^(app|demo)$');

    await vscode.commands.executeCommand('cmakerunner.filterTargets');

    const targetsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.targets') as any;
    const provider = targetsTreeView?.options.treeDataProvider;
    const children = await provider.getChildren();

    assert.strictEqual(targetsTreeView?.description, 'Regex: ^(app|demo)$');
    assert.deepStrictEqual(children.map((item: { label: string }) => item.label), ['app', 'demo']);
  });

  it('filterTargets warns and keeps the current filter when the typed regex is invalid', async () => {
    await activateExtension();

    let warning = '';
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warning = message;
      return undefined;
    };
    setRegexQuickPickInput('[');

    try {
      await vscode.commands.executeCommand('cmakerunner.filterTargets');
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    const targetsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.targets');
    assert.ok(warning.includes('Invalid regular expression'));
    assert.strictEqual(targetsTreeView?.description, undefined);
  });

  it('runTarget warns and skips workflow for shared-library targets', async () => {
    await activateExtension();

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalRunTarget = workflowModule.WorkflowManager.prototype.runTarget;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warnedMessage = '';
    let runCalled = false;

    workflowModule.WorkflowManager.prototype.runTarget = async () => {
      runCalled = true;
    };
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnedMessage = message;
      return undefined;
    };

    const libraryTarget = new TargetTreeItem({
      id: 'mylib',
      name: 'mylib',
      displayName: 'mylib',
      type: 'SHARED_LIBRARY',
      sourceFiles: [appSourcePath],
      guessedExecutablePath: path.join(fixtureRoot, 'bin', 'mylib.dll'),
    });

    try {
      await vscode.commands.executeCommand('cmakerunner.runTarget', libraryTarget);
    } finally {
      workflowModule.WorkflowManager.prototype.runTarget = originalRunTarget;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(runCalled, false);
    assert.ok(warnedMessage.includes('SHARED_LIBRARY'));
    assert.ok(warnedMessage.includes('cannot be run'));
  });

  it('debugTarget warns and skips workflow for shared-library targets', async () => {
    await activateExtension();

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalDebugTarget = workflowModule.WorkflowManager.prototype.debugTarget;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let warnedMessage = '';
    let debugCalled = false;

    workflowModule.WorkflowManager.prototype.debugTarget = async () => {
      debugCalled = true;
    };
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnedMessage = message;
      return undefined;
    };

    const libraryTarget = new TargetTreeItem({
      id: 'mylib',
      name: 'mylib',
      displayName: 'mylib',
      type: 'SHARED_LIBRARY',
      sourceFiles: [appSourcePath],
      guessedExecutablePath: path.join(fixtureRoot, 'bin', 'mylib.dll'),
    });

    try {
      await vscode.commands.executeCommand('cmakerunner.debugTarget', libraryTarget);
    } finally {
      workflowModule.WorkflowManager.prototype.debugTarget = originalDebugTarget;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(debugCalled, false);
    assert.ok(warnedMessage.includes('SHARED_LIBRARY'));
    assert.ok(warnedMessage.includes('cannot be debugged'));
  });

  it('registers GTests in VS Code Test Explorer instead of a custom GTests view', async () => {
    await activateExtension();

    assert.ok(mockedVscode.__mock.createdTreeViews.has('cmakerunner.targets'));
    assert.ok(!mockedVscode.__mock.createdTreeViews.has('cmakerunner.gtests'));
    assert.ok(mockedVscode.__mock.createdTestControllers.has('cmakerunner.gtests'));
  });

  it('buildPreset success message shows duration without target details', async () => {
    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildPreset = workflowModule.WorkflowManager.prototype.buildPreset;
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    let shownMessage = '';

    workflowModule.WorkflowManager.prototype.buildPreset = async () => ({ succeeded: true, durationMs: 1200 });
    (vscode.window as any).showInformationMessage = async (message: string) => {
      shownMessage = message;
      return undefined;
    };

    try {
      await activateExtension();
      await vscode.commands.executeCommand('cmakerunner.buildPreset');
    } finally {
      workflowModule.WorkflowManager.prototype.buildPreset = originalBuildPreset;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }

    assert.strictEqual(shownMessage, 'Preset Debug configured successfully in 1.2 s.');
    assert.ok(!shownMessage.includes('Targets:'));
  });
});
