import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type MockVscode = typeof vscode & {
  __mock: {
    readonly registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    readonly createdTreeViews: Map<string, {
      description?: string;
      message?: string;
    }>;
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
    (vscode.window as any).showQuickPick = async (items: readonly { label: string }[]) => {
      const quickPickItems = items as Array<{ label: string }>;
      pickedLabels.push(...quickPickItems.map((item) => item.label));
      return quickPickItems.find((item) => item.label === 'demo');
    };

    await vscode.commands.executeCommand('cmakerunner.filterTargets');

    const targetsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.targets');
    assert.ok(targetsTreeView);
    assert.deepStrictEqual(pickedLabels, ['app', 'demo', 'helper']);
    assert.strictEqual(targetsTreeView?.description, 'Filter: demo');
  });

  it('filterTargets exposes source file paths in quick pick details for search', async () => {
    await activateExtension();

    const pickedItems: Array<{ label: string; detail?: string }> = [];
    (vscode.window as any).showQuickPick = async (items: readonly { label: string; detail?: string }[]) => {
      pickedItems.push(...items as Array<{ label: string; detail?: string }>);
      return undefined;
    };

    await vscode.commands.executeCommand('cmakerunner.filterTargets');

    const appItem = pickedItems.find((item) => item.label === 'app');
    const demoItem = pickedItems.find((item) => item.label === 'demo');
    assert.ok(appItem?.detail?.includes(path.join('src', 'app.cpp')));
    assert.ok(demoItem?.detail?.includes(path.join('src', 'demo.cpp')));
    assert.ok(appItem?.detail?.includes(path.join('src', 'common.cpp')));
  });

  it('runGTestCase resolves the active source file target', async () => {
    await activateExtension();

    let gtestTargetName: string | undefined;
    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalRunGTestCase = workflowModule.WorkflowManager.prototype.runGTestCase;
    workflowModule.WorkflowManager.prototype.runGTestCase = async (_preset, target) => {
      gtestTargetName = target.name;
    };

    try {
      await vscode.commands.executeCommand('cmakerunner.runGTestCase');
    } finally {
      workflowModule.WorkflowManager.prototype.runGTestCase = originalRunGTestCase;
    }

    assert.strictEqual(gtestTargetName, 'app');
  });

  it('creates a GTests view alongside the Targets view', async () => {
    await activateExtension();

    assert.ok(mockedVscode.__mock.createdTreeViews.has('cmakerunner.targets'));
    assert.ok(mockedVscode.__mock.createdTreeViews.has('cmakerunner.gtests'));
  });

  it('filterGTests applies and clears the gtest view filter', async () => {
    await activateExtension();

    (vscode.window as any).showInputBox = async () => 'MathTest';
    await vscode.commands.executeCommand('cmakerunner.filterGTests');

    const gtestsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.gtests');
    assert.ok(gtestsTreeView);
    assert.strictEqual(gtestsTreeView?.description, 'Filter: MathTest');

    await vscode.commands.executeCommand('cmakerunner.clearGTestFilter');
    assert.strictEqual(gtestsTreeView?.description, undefined);
  });

  it('clears the gtest filter when switching to a different target', async () => {
    await activateExtension();

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildTarget = workflowModule.WorkflowManager.prototype.buildTarget;
    workflowModule.WorkflowManager.prototype.buildTarget = async () => {};

    (vscode.window as any).showInputBox = async () => 'MathTest';
    await vscode.commands.executeCommand('cmakerunner.filterGTests');

    (vscode.window as any).showQuickPick = async (items: readonly { label: string }[]) => {
      const quickPickItems = items as Array<{ label: string }>;
      return quickPickItems.find((item) => item.label === 'demo');
    };

    try {
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
    } finally {
      workflowModule.WorkflowManager.prototype.buildTarget = originalBuildTarget;
    }

    const gtestsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.gtests');
    assert.ok(gtestsTreeView);
    assert.strictEqual(gtestsTreeView?.description, undefined);
  });
});
