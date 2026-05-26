import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { GTestCaseTreeItem } from '../src/ui/gtestTreeDataProvider';

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

  it('runGTestCase resolves the active source file target', async () => {
    await activateExtension();

    let gtestTargetName: string | undefined;
    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalRunGTestCase = workflowModule.WorkflowManager.prototype.runGTestCase;
    workflowModule.WorkflowManager.prototype.runGTestCase = async (_preset, target) => {
      gtestTargetName = target.name;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand('cmakerunner.runGTestCase');
    } finally {
      workflowModule.WorkflowManager.prototype.runGTestCase = originalRunGTestCase;
    }

    assert.strictEqual(gtestTargetName, 'app');
  });

  it('openGTestCaseSource opens the matching source file', async () => {
    await activateExtension();

    fs.writeFileSync(appSourcePath, [
      '#include <gtest/gtest.h>',
      '',
      'TEST(MathTest, Adds) {',
      '  ASSERT_TRUE(true);',
      '}',
    ].join('\n'));

    let shownEditor: vscode.TextEditor | undefined;
    (vscode.window as any).showTextDocument = async (document: vscode.TextDocument) => {
      shownEditor = {
        document,
        revealRange: () => undefined,
      } as unknown as vscode.TextEditor;
      return shownEditor;
    };

    const item = new GTestCaseTreeItem({
      id: 'app',
      name: 'app',
      displayName: 'app',
      sourceFiles: [appSourcePath],
      guessedExecutablePath: path.join(fixtureRoot, 'bin', 'app'),
    }, { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' });

    await vscode.commands.executeCommand('cmakerunner.openGTestCaseSource', item);

    assert.strictEqual(shownEditor?.document.uri.fsPath, appSourcePath);
    assert.strictEqual(shownEditor?.selection.active.line, 2);
  });

  it('debugGTestCase delegates the selected tree item to the workflow manager', async () => {
    await activateExtension();

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalDebugGTestCase = workflowModule.WorkflowManager.prototype.debugGTestCase;
    let debuggedFilter: string | undefined;

    workflowModule.WorkflowManager.prototype.debugGTestCase = async (_preset, _target, testCase) => {
      debuggedFilter = testCase.filter;
    };

    const item = new GTestCaseTreeItem({
      id: 'app',
      name: 'app',
      displayName: 'app',
      sourceFiles: [appSourcePath],
      guessedExecutablePath: path.join(fixtureRoot, 'bin', 'app'),
    }, { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' });

    try {
      await vscode.commands.executeCommand('cmakerunner.debugGTestCase', item);
    } finally {
      workflowModule.WorkflowManager.prototype.debugGTestCase = originalDebugGTestCase;
    }

    assert.strictEqual(debuggedFilter, 'MathTest.Adds');
  });

  it('creates a GTests view alongside the Targets view', async () => {
    await activateExtension();

    assert.ok(mockedVscode.__mock.createdTreeViews.has('cmakerunner.targets'));
    assert.ok(mockedVscode.__mock.createdTreeViews.has('cmakerunner.gtests'));
  });

  it('filterGTests applies and clears the gtest view filter', async () => {
    await activateExtension();

    fs.mkdirSync(path.join(fixtureRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'bin', 'app'), '');

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildTarget = workflowModule.WorkflowManager.prototype.buildTarget;
    const originalListGTestCases = workflowModule.WorkflowManager.prototype.listGTestCases;
    const pickedLabels: string[][] = [];

    workflowModule.WorkflowManager.prototype.buildTarget = async () => {};
    workflowModule.WorkflowManager.prototype.listGTestCases = async () => [
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      { suite: 'MathTest', name: 'Divides', filter: 'MathTest.Divides' },
      { suite: 'StringTest', name: 'Splits', filter: 'StringTest.Splits' },
    ];
    (vscode.window as any).showQuickPick = async (items: readonly { label: string; target?: unknown }[]) => {
      const quickPickItems = items as Array<{ label: string; target?: unknown }>;
      pickedLabels.push(quickPickItems.map((item) => item.label));
      return quickPickItems.find((item) => item.label === 'app');
    };
    setQuickPickItemSelection('MathTest', (items) => {
      pickedLabels.push(items.map((item) => item.label));
    });

    try {
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
      await vscode.commands.executeCommand('cmakerunner.filterGTests');
    } finally {
      workflowModule.WorkflowManager.prototype.buildTarget = originalBuildTarget;
      workflowModule.WorkflowManager.prototype.listGTestCases = originalListGTestCases;
    }

    const gtestsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.gtests');
    assert.ok(gtestsTreeView);
    assert.strictEqual(gtestsTreeView?.description, 'Filter: MathTest');
    assert.ok(pickedLabels[1].includes('MathTest.Adds'));
    assert.ok(pickedLabels[1].includes('MathTest.Divides'));
    assert.ok(pickedLabels[1].includes('StringTest.Splits'));

    await vscode.commands.executeCommand('cmakerunner.clearGTestFilter');
    assert.strictEqual(gtestsTreeView?.description, undefined);
  });

  it('filterGTests applies typed regular expressions to all matching test cases', async () => {
    await activateExtension();

    fs.mkdirSync(path.join(fixtureRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'bin', 'app'), '');

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildTarget = workflowModule.WorkflowManager.prototype.buildTarget;
    const originalListGTestCases = workflowModule.WorkflowManager.prototype.listGTestCases;

    workflowModule.WorkflowManager.prototype.buildTarget = async () => {};
    workflowModule.WorkflowManager.prototype.listGTestCases = async () => [
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      { suite: 'MathTest', name: 'Divides', filter: 'MathTest.Divides' },
      { suite: 'StringTest', name: 'Splits', filter: 'StringTest.Splits' },
    ];
    (vscode.window as any).showQuickPick = async (items: readonly { label: string; target?: unknown }[]) => {
      const quickPickItems = items as Array<{ label: string; target?: unknown }>;
      return quickPickItems.find((item) => item.label === 'app');
    };
    setRegexQuickPickInput('^MathTest\\.');

    try {
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
      await vscode.commands.executeCommand('cmakerunner.filterGTests');

      const gtestsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.gtests') as any;
      const provider = gtestsTreeView?.options.treeDataProvider;
      const [targetItem] = await provider.getChildren();
      const cases = await provider.getChildren(targetItem);

      assert.strictEqual(gtestsTreeView?.description, 'Regex: ^MathTest\\.');
      assert.deepStrictEqual(cases.map((item: { label: string }) => item.label), ['Adds', 'Divides']);
    } finally {
      workflowModule.WorkflowManager.prototype.buildTarget = originalBuildTarget;
      workflowModule.WorkflowManager.prototype.listGTestCases = originalListGTestCases;
    }
  });

  it('runGTestCase runs visible filtered cases when invoked from a gtest target', async () => {
    await activateExtension();

    fs.mkdirSync(path.join(fixtureRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'bin', 'app'), '');

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildTarget = workflowModule.WorkflowManager.prototype.buildTarget;
    const originalListGTestCases = workflowModule.WorkflowManager.prototype.listGTestCases;
    const originalRunGTestCases = workflowModule.WorkflowManager.prototype.runGTestCases;
    const originalRunAllGTestCases = workflowModule.WorkflowManager.prototype.runAllGTestCases;
    let ranAll = false;
    let filters: string[] = [];

    workflowModule.WorkflowManager.prototype.buildTarget = async () => {};
    workflowModule.WorkflowManager.prototype.listGTestCases = async () => [
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      { suite: 'MathTest', name: 'Divides', filter: 'MathTest.Divides' },
      { suite: 'StringTest', name: 'Splits', filter: 'StringTest.Splits' },
    ];
    workflowModule.WorkflowManager.prototype.runGTestCases = async (_preset, _target, testCases) => {
      filters = testCases.map((testCase) => testCase.filter);
      return undefined;
    };
    workflowModule.WorkflowManager.prototype.runAllGTestCases = async () => {
      ranAll = true;
      return undefined;
    };
    (vscode.window as any).showQuickPick = async (items: readonly { label: string; target?: unknown }[]) => {
      const quickPickItems = items as Array<{ label: string; target?: unknown }>;
      return quickPickItems.find((item) => item.label === 'app');
    };
    setQuickPickItemSelection('MathTest');

    try {
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
      await vscode.commands.executeCommand('cmakerunner.filterGTests');
      const gtestsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.gtests') as any;
      const provider = gtestsTreeView?.options.treeDataProvider;
      const [targetItem] = await provider.getChildren();

      await vscode.commands.executeCommand('cmakerunner.runGTestCase', targetItem);
    } finally {
      workflowModule.WorkflowManager.prototype.buildTarget = originalBuildTarget;
      workflowModule.WorkflowManager.prototype.listGTestCases = originalListGTestCases;
      workflowModule.WorkflowManager.prototype.runGTestCases = originalRunGTestCases;
      workflowModule.WorkflowManager.prototype.runAllGTestCases = originalRunAllGTestCases;
    }

    assert.strictEqual(ranAll, false);
    assert.deepStrictEqual(filters, ['MathTest.Adds', 'MathTest.Divides']);
  });

  it('clears the gtest filter when switching to a different target', async () => {
    await activateExtension();

    fs.mkdirSync(path.join(fixtureRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'bin', 'app'), '');

    const workflowModule = require('../src/services/workflowManager') as typeof import('../src/services/workflowManager');
    const originalBuildTarget = workflowModule.WorkflowManager.prototype.buildTarget;
    const originalListGTestCases = workflowModule.WorkflowManager.prototype.listGTestCases;
    let targetPickCount = 0;

    workflowModule.WorkflowManager.prototype.buildTarget = async () => {};
    workflowModule.WorkflowManager.prototype.listGTestCases = async () => [
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
    ];

    (vscode.window as any).showQuickPick = async (items: readonly { label: string; target?: unknown }[]) => {
      const quickPickItems = items as Array<{ label: string; target?: unknown }>;
      targetPickCount += 1;
      return quickPickItems.find((item) => item.label === (targetPickCount === 1 ? 'app' : 'demo'));
    };
    setQuickPickItemSelection('MathTest');

    try {
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
      await vscode.commands.executeCommand('cmakerunner.filterGTests');
      await vscode.commands.executeCommand('cmakerunner.buildTargetFromCurrentFile');
    } finally {
      workflowModule.WorkflowManager.prototype.buildTarget = originalBuildTarget;
      workflowModule.WorkflowManager.prototype.listGTestCases = originalListGTestCases;
    }

    const gtestsTreeView = mockedVscode.__mock.createdTreeViews.get('cmakerunner.gtests');
    assert.ok(gtestsTreeView);
    assert.strictEqual(gtestsTreeView?.description, undefined);
  });
});
