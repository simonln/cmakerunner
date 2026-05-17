import * as assert from 'assert';
import { GTestCaseTreeItem, GTestTargetTreeItem, GTestTreeDataProvider } from '../src/ui/gtestTreeDataProvider';
import { PresetTreeDataProvider, PresetTreeItem } from '../src/ui/presetTreeDataProvider';
import { TargetTreeDataProvider, TargetTreeItem, SourceTreeItem } from '../src/ui/targetTreeDataProvider';
import { TargetInfo } from '../src/models';

describe('ui', () => {
  describe('PresetTreeDataProvider', () => {
    it('should create tree data provider', () => {
      const provider = new PresetTreeDataProvider();
      assert.ok(provider);
    });

    it('should set presets and fire change event', () => {
      const provider = new PresetTreeDataProvider();
      let changed = false;
      provider.onDidChangeTreeData(() => {
        changed = true;
      });

      provider.setPresets([], undefined);
      assert.strictEqual(changed, true);
    });

    it('should find item by preset name', () => {
      const provider = new PresetTreeDataProvider();
      provider.setPresets([
        {
          name: 'debug',
          displayName: 'Debug',
          binaryDir: '/build/debug',
          sourceDir: '/src',
        },
      ], 'debug');

      const item = provider.findItem('debug');
      assert.ok(item instanceof PresetTreeItem);
    });

    it('should return undefined for unknown preset', () => {
      const provider = new PresetTreeDataProvider();
      provider.setPresets([], undefined);
      const item = provider.findItem('unknown');
      assert.strictEqual(item, undefined);
    });

    it('should return tree items from getChildren', async () => {
      const provider = new PresetTreeDataProvider();
      provider.setPresets([
        {
          name: 'debug',
          displayName: 'Debug',
          binaryDir: '/build/debug',
          sourceDir: '/src',
        },
      ], 'debug');
      const children = await provider.getChildren();
      assert.strictEqual(children.length, 1);
      assert.strictEqual(provider.getTreeItem(children[0]), children[0]);
    });
  });

  describe('PresetTreeItem', () => {
    it('should create tree item with preset info', () => {
      const preset = {
        name: 'debug',
        displayName: 'Debug',
        binaryDir: '/build/debug',
        sourceDir: '/src',
      };
      const item = new PresetTreeItem(preset, false);
      assert.strictEqual(item.label, 'Debug');
      assert.strictEqual(item.contextValue, 'preset');
    });

    it('should show check icon when selected', () => {
      const preset = {
        name: 'debug',
        displayName: 'Debug',
        binaryDir: '/build/debug',
        sourceDir: '/src',
      };
      const item = new PresetTreeItem(preset, true);
      assert.strictEqual(item.description, 'Current');
    });

    it('should include command and tooltip details', () => {
      const preset = {
        name: 'debug',
        displayName: 'Debug',
        binaryDir: '/build/debug',
        sourceDir: '/src',
        description: 'Debug preset',
      };
      const item = new PresetTreeItem(preset, false);
      assert.strictEqual(item.command?.command, 'cmakerunner.selectPreset');
      assert.ok(String(item.tooltip).includes('/build/debug'));
    });
  });

  describe('TargetTreeDataProvider', () => {
    it('should create target tree data provider', () => {
      const provider = new TargetTreeDataProvider();
      assert.ok(provider);
    });

    it('should set targets and fire change event', () => {
      const provider = new TargetTreeDataProvider();
      let changed = false;
      provider.onDidChangeTreeData(() => {
        changed = true;
      });

      provider.setTargets([], '/src', undefined);
      assert.strictEqual(changed, true);
    });

    it('should return zero visible targets when empty', () => {
      const provider = new TargetTreeDataProvider();
      provider.setTargets([], '/src', undefined);
      assert.strictEqual(provider.getVisibleTargetCount(), 0);
    });

    it('should filter targets by name', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
        {
          id: 'other',
          name: 'other',
          displayName: 'Other',
          sourceFiles: ['/src/other.cpp'],
          guessedExecutablePath: '/build/other',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      provider.setFilterText('myapp');
      assert.strictEqual(provider.getVisibleTargetCount(), 1);
    });

    it('should filter targets by source file', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      provider.setFilterText('main');
      assert.strictEqual(provider.getVisibleTargetCount(), 1);
    });

    it('should filter targets by source relative path with either separator', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/app/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      provider.setFilterText('app/main.cpp');
      assert.strictEqual(provider.getVisibleTargetCount(), 1);

      provider.setFilterText('app\\main.cpp');
      assert.strictEqual(provider.getVisibleTargetCount(), 1);
    });

    it('should clear filter', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      provider.setFilterText('myapp');
      provider.setFilterText('');
      assert.strictEqual(provider.getVisibleTargetCount(), 1);
    });

    it('should find target item by id', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      const item = provider.findTargetItem('myapp');
      assert.ok(item instanceof TargetTreeItem);
    });

    it('should find first source item by file path', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      const item = provider.findFirstSourceItemByFile('/src/main.cpp');
      assert.ok(item instanceof SourceTreeItem);
    });

    it('should return parent for source item', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', undefined);
      const sourceItem = provider.findFirstSourceItemByFile('/src/main.cpp');
      const parent = provider.getParent(sourceItem as SourceTreeItem);
      assert.ok(parent instanceof TargetTreeItem);
    });

    it('should track active source path', () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [
        {
          id: 'myapp',
          name: 'myapp',
          displayName: 'My App',
          sourceFiles: ['/src/main.cpp'],
          guessedExecutablePath: '/build/myapp',
        },
      ];

      provider.setTargets(targets, '/src', '/src/main.cpp');
      const children = provider.getChildren();
      assert.ok(children);
    });

    it('should return children for a target item', async () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [{
        id: 'myapp',
        name: 'myapp',
        displayName: 'My App',
        sourceFiles: ['/src/main.cpp', '/src/lib.cpp'],
        guessedExecutablePath: '/build/myapp',
      }];
      provider.setTargets(targets, '/src', undefined);
      const rootChildren = await provider.getChildren();
      const nestedChildren = await provider.getChildren(rootChildren[0]);
      assert.strictEqual(rootChildren.length, 1);
      assert.strictEqual(nestedChildren.length, 2);
      assert.strictEqual(provider.getTreeItem(rootChildren[0]), rootChildren[0]);
    });

    it('should return only matching source children when filter matches source path', async () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [{
        id: 'myapp',
        name: 'myapp',
        displayName: 'My App',
        sourceFiles: ['/src/main.cpp', '/src/lib.cpp'],
        guessedExecutablePath: '/build/myapp',
      }];
      provider.setTargets(targets, '/src', undefined);
      provider.setFilterText('lib.cpp');
      const rootChildren = await provider.getChildren();
      const nestedChildren = await provider.getChildren(rootChildren[0]);
      assert.strictEqual(nestedChildren.length, 1);
      assert.strictEqual((nestedChildren[0] as SourceTreeItem).sourcePath, '/src/lib.cpp');
    });

    it('should return empty children for source items and undefined parent for targets', async () => {
      const provider = new TargetTreeDataProvider();
      const targets: TargetInfo[] = [{
        id: 'myapp',
        name: 'myapp',
        displayName: 'My App',
        sourceFiles: ['/src/main.cpp'],
        guessedExecutablePath: '/build/myapp',
      }];
      provider.setTargets(targets, '/src', undefined);
      const source = provider.findFirstSourceItemByFile('/src/main.cpp') as SourceTreeItem;
      const sourceChildren = await provider.getChildren(source);
      const targetItem = provider.findTargetItem('myapp') as TargetTreeItem;
      assert.deepStrictEqual(sourceChildren, []);
      assert.strictEqual(provider.getParent(targetItem), undefined);
    });

    it('should trim filter text and expose it', () => {
      const provider = new TargetTreeDataProvider();
      provider.setFilterText('  app  ');
      assert.strictEqual(provider.getFilterText(), 'app');
    });

    it('should return undefined when source item is not found', () => {
      const provider = new TargetTreeDataProvider();
      provider.setTargets([], '/src', undefined);
      assert.strictEqual(provider.findFirstSourceItemByFile('/src/missing.cpp'), undefined);
    });
  });

  describe('TargetTreeItem', () => {
    it('should create target tree item', () => {
      const target: TargetInfo = {
        id: 'myapp',
        name: 'myapp',
        displayName: 'My App',
        sourceFiles: ['/src/main.cpp'],
        guessedExecutablePath: '/build/myapp',
      };
      const item = new TargetTreeItem(target);
      assert.strictEqual(item.label, 'My App');
      assert.strictEqual(item.contextValue, 'target');
      assert.ok(String(item.tooltip).includes('/build/myapp'));
    });
  });

  describe('SourceTreeItem', () => {
    it('should create source tree item', () => {
      const item = new SourceTreeItem('/src/main.cpp', 'myapp', '/src', false);
      assert.ok(item.label);
      assert.strictEqual(item.contextValue, 'source');
      assert.strictEqual(item.command?.command, 'vscode.open');
    });

    it('should show current indicator when active', () => {
      const item = new SourceTreeItem('/src/main.cpp', 'myapp', '/src', true);
      assert.strictEqual(item.description, 'Current');
    });
  });

  describe('GTestTreeDataProvider', () => {
    const target: TargetInfo = {
      id: 'tests',
      name: 'tests',
      displayName: 'Tests',
      sourceFiles: ['/src/tests.cpp'],
      guessedExecutablePath: '/build/tests',
    };

    it('should expose gtest targets as root items', async () => {
      const provider = new GTestTreeDataProvider(async () => []);
      provider.setTargets([target]);
      provider.setSelectedTarget(target, true);

      const children = await provider.getChildren();
      assert.strictEqual(children.length, 1);
      assert.ok(children[0] instanceof GTestTargetTreeItem);
      assert.strictEqual(children[0].contextValue, 'gtestTarget');
    });

    it('should discover and expose gtest cases below a target', async () => {
      const provider = new GTestTreeDataProvider(async () => [
        { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      ]);
      provider.setTargets([target]);
      provider.setSelectedTarget(target, true);

      const [targetItem] = await provider.getChildren();
      const cases = await provider.getChildren(targetItem);

      assert.strictEqual(cases.length, 1);
      assert.ok(cases[0] instanceof GTestCaseTreeItem);
      assert.strictEqual(cases[0].contextValue, 'gtestCase');
      assert.strictEqual(cases[0].command, undefined);
    });

    it('should cache discovered cases until refresh', async () => {
      let discoverCount = 0;
      const provider = new GTestTreeDataProvider(async () => {
        discoverCount += 1;
        return [{ suite: 'MathTest', name: `Case${discoverCount}`, filter: `MathTest.Case${discoverCount}` }];
      });
      provider.setTargets([target]);
      provider.setSelectedTarget(target, true);

      const [targetItem] = await provider.getChildren();
      await provider.getChildren(targetItem);
      await provider.getChildren(targetItem);
      assert.strictEqual(discoverCount, 1);

      provider.refresh();
      await provider.getChildren(targetItem);
      assert.strictEqual(discoverCount, 2);
    });

    it('should filter gtest targets by target name', async () => {
      const provider = new GTestTreeDataProvider(async () => []);
      provider.setTargets([
        target,
        {
          id: 'app',
          name: 'app',
          displayName: 'App',
          sourceFiles: ['/src/app.cpp'],
          guessedExecutablePath: '/build/app',
        },
      ]);
      provider.setSelectedTarget(target, true);

      provider.setFilterText('tests');
      const children = await provider.getChildren();
      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0].label, 'Tests');
      assert.strictEqual(await provider.getVisibleTargetCount(), 1);
    });

    it('should filter gtest cases by suite or case name', async () => {
      const provider = new GTestTreeDataProvider(async () => [
        { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
        { suite: 'StringTest', name: 'Splits', filter: 'StringTest.Splits' },
      ]);
      provider.setTargets([target]);
      provider.setSelectedTarget(target, true);

      provider.setFilterText('splits');
      const [targetItem] = await provider.getChildren();
      const cases = await provider.getChildren(targetItem);

      assert.strictEqual(cases.length, 1);
      assert.strictEqual(cases[0].label, 'Splits');
      assert.strictEqual(await provider.getVisibleTargetCount(), 1);
    });

    it('should clear gtest filter text', () => {
      const provider = new GTestTreeDataProvider(async () => []);
      provider.setFilterText('math');
      assert.strictEqual(provider.getFilterText(), 'math');
      provider.setFilterText('');
      assert.strictEqual(provider.getFilterText(), '');
    });

    it('should stay empty until a built target is selected', async () => {
      const provider = new GTestTreeDataProvider(async () => []);
      provider.setTargets([target]);

      assert.strictEqual(provider.getMessage(), 'Select a target and build it to view GoogleTest cases.');
      assert.strictEqual((await provider.getChildren()).length, 0);

      provider.setSelectedTarget(target, false);
      assert.strictEqual(provider.getMessage(), 'Build the selected target successfully to view GoogleTest cases.');
      assert.strictEqual((await provider.getChildren()).length, 0);
    });
  });
});
