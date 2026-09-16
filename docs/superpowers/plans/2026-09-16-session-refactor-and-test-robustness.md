# Session 重构与测试健壮性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收拢扩展状态到 SessionStore、把 `extension.ts` 拆成组装层、移除假 compile_commands fallback，并为 Test Explorer 的 GoogleTest 运行补上超时与中断能力。

**Architecture:** 阶段 A 引入 `src/app/`（SessionStore、SessionLoader、commands）并把视图封装为 `PresetsView`/`TargetsView`；`MappingEngine` 无状态化。阶段 C 新增 `processRunner.ts` 供测试运行/发现复用，接入可配置超时与取消。命令 ID、设置键、视图 ID、惰性初始化语义保持不变。GTest 发现规则（阶段 B）推迟到独立计划。

**Tech Stack:** TypeScript / VS Code Extension API / Mocha / c8 / 自研 vscode-mock。`npm test` = tsc 编译到 `out/` + `test/run-unit.js`（`test/vscode-mock.js` 注入 mock）。

**执行环境:** 仓库目录，分支 `refactor/v0.5.0-architecture`，每个 Task 一个提交，不推送、不合并。

---

## 文件结构

```text
Create: src/app/sessionStore.ts              状态唯一源 + 事件
Create: src/app/sessionLoader.ts             惰性初始化/刷新/竞态守卫
Create: src/app/commandGuards.ts             preset/target 守卫
Create: src/app/commands/types.ts            CommandContext 依赖接口
Create: src/app/commands/presetCommands.ts   selectPreset/buildPreset/rebuildPreset
Create: src/app/commands/targetCommands.ts   buildTarget/buildTargetFromCurrentFile/runTarget/debugTarget
Create: src/app/commands/viewCommands.ts     refresh/filterTargets/clearTargetFilter/refreshGTests
Create: src/services/processRunner.ts        可超时/可取消的进程执行 + 杀进程树
Create: src/services/buildDirectoryCleaner.ts
Create: src/ui/presetsView.ts
Create: src/ui/targetsView.ts
Create: src/ui/targetPicker.ts
Modify: src/models.ts                        createEmptyMapping()
Modify: src/services/mappingEngine.ts        无状态 build()
Modify: src/services/configurationManager.ts getGTestCaseTimeoutMs()
Modify: src/services/testController.ts       store 订阅 + runProcess + 超时/取消
Modify: src/services/workflowManager.ts      formatDuration 导入
Modify: src/utils.ts                         formatDuration()
Modify: src/extension.ts                     仅组装
Modify: package.json                         gtests.caseTimeoutMs + version
Modify: test/{integration,services,extension,testController}.test.ts
Create: test/sessionStore.test.ts
Create: test/sessionLoader.test.ts
Create: test/processRunner.test.ts
```

---

## Task 0：分支、基线与文档

**Files:**
- Create: `docs/superpowers/specs/2026-09-16-session-refactor-and-test-robustness-design.md`
- Create: `docs/superpowers/plans/2026-09-16-session-refactor-and-test-robustness.md`

- [x] 基于 `main` 创建分支 `refactor/v0.5.0-architecture`
- [x] 基线：`npm run compile && npm test`（149 passing 全绿）
- [x] 提交设计文档与本计划

```bash
git add docs/superpowers
git commit -m "docs: add session refactor and test robustness plan"
```

---

## Task A1：MappingEngine 无状态化 + 移除假 fallback

**Files:**
- Modify: `src/models.ts`（新增 `createEmptyMapping`）
- Modify: `src/services/mappingEngine.ts`
- Modify: `test/integration.test.ts`（MappingEngine describe 全部改写）

- [ ] **Step 1: `src/models.ts` 末尾新增工厂函数**

```ts
export function createEmptyMapping(): MappingIndex {
  return {
    targets: new Map<string, TargetInfo>(),
    sourceToTargets: new Map<string, string[]>(),
  };
}
```

- [ ] **Step 2: 重写 `src/services/mappingEngine.ts` 的公开接口**

```ts
public async build(preset: PresetInfo): Promise<MappingIndex> {
  try {
    const index = await this.buildIndexFromFileApi(preset);
    if (index.targets.size > 0) {
      this.logger.info(`Mapping rebuilt from CMake File API with ${index.targets.size} supported target(s)`);
      return index;
    }

    this.logger.warn(
      `No supported targets found in the CMake File API reply for preset ${preset.name}; run Build on this preset first`,
    );
    return createEmptyMapping();
  } catch (error) {
    this.logger.warn(
      `Unable to read the CMake File API reply for preset ${preset.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return createEmptyMapping();
  }
}
```

删除 `currentIndex`、`getTargets()`、`findTargetsBySource()`、`createEmptyIndex()`；`buildIndexFromFileApi` 内 `return this.createEmptyIndex()` 改为 `return createEmptyMapping()`。新增导入 `createEmptyMapping`。

- [ ] **Step 3: 改写 `test/integration.test.ts` 的 `describe('MappingEngine')`**

每个用例改为：

```ts
const mapping = await engine.build(preset);
assert.strictEqual(mapping.targets.size, 0);          // 空场景
const targets = [...mapping.targets.values()];         // 有结果场景
```

`findTargetsBySource` 相关断言迁移到 Task A2 的 `sessionStore.test.ts`。新增无状态回归用例：

```ts
it('should not retain a previous mapping when the next build has no targets', async () => {
  const engine = new MappingEngine(logger);
  const populated = await engine.build({
    name: 'debug', displayName: 'Debug',
    binaryDir: path.join(mappingWorkspaceDir, 'build', 'debug'), sourceDir: mappingWorkspaceDir,
  });
  const empty = await engine.build({
    name: 'debug', displayName: 'Debug',
    binaryDir: path.join(mappingEmptyWorkspaceDir, 'build', 'debug'), sourceDir: mappingEmptyWorkspaceDir,
  });
  assert.ok(populated.targets.size > 0);
  assert.strictEqual(empty.targets.size, 0);
});
```

- [ ] **Step 4: 验证**: `npm run compile && npm test`
- [ ] **Step 5: Commit**

```bash
git add src/models.ts src/services/mappingEngine.ts test/integration.test.ts
git commit -m "refactor(mapping): make target index stateless and remove the fake compile_commands fallback"
```

---

## Task A2：SessionStore

**Files:**
- Create: `src/app/sessionStore.ts`
- Create: `test/sessionStore.test.ts`

- [ ] **Step 1: 先写 `test/sessionStore.test.ts`（失败）**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionStore } from '../src/app/sessionStore';
import { MappingIndex, PresetInfo, TargetInfo } from '../src/models';
import { createMockOutputChannel } from './helpers';
import { OutputLogger } from '../src/services/outputLogger';

describe('session store', () => {
  const presetA: PresetInfo = { name: 'a', displayName: 'A', binaryDir: '/b/a', sourceDir: '/src' };
  const presetB: PresetInfo = { name: 'b', displayName: 'B', binaryDir: '/b/b', sourceDir: '/src' };
  const target: TargetInfo = {
    id: 'app', name: 'app', displayName: 'app', type: 'EXECUTABLE',
    sourceFiles: ['/src/main.cpp'], guessedExecutablePath: '/b/a/app',
  };

  function createMemento(initial?: string) {
    const state = new Map<string, string>();
    if (initial) state.set('cmakerunner.selectedPreset', initial);
    return {
      get: (key: string) => state.get(key),
      update: async (key: string, value: string) => { state.set(key, value); },
      keys: () => [...state.keys()],
      setKeysForSync: () => {},
    };
  }

  it('resolves the stored preset and persists the effective selection', async () => {
    const store = new SessionStore(createMemento('b') as unknown as vscode.Memento, new OutputLogger(createMockOutputChannel()));
    await store.setPresets([presetA, presetB]);
    assert.strictEqual(store.getCurrentPreset()?.name, 'b');
    await store.selectPreset(presetA);
    assert.strictEqual(store.getCurrentPreset()?.name, 'a');
  });

  it('clears targets when the preset changes and exposes the new mapping', async () => {
    const store = new SessionStore(createMemento() as unknown as vscode.Memento, new OutputLogger(createMockOutputChannel()));
    const targetsChanged: number[] = [];
    store.onDidChangeTargets(() => targetsChanged.push(store.getTargets().length));

    const mapping: MappingIndex = {
      targets: new Map([[target.id, target]]),
      sourceToTargets: new Map([['/src/main.cpp', [target.id]]]),
    };
    store.setMapping(mapping);
    assert.strictEqual(store.getTargets().length, 1);
    assert.strictEqual(store.findTargetsBySource('\\src\\main.cpp').length, 1);

    await store.selectPreset(presetB);
    assert.deepStrictEqual(store.getTargets(), []);
    assert.deepStrictEqual(targetsChanged, [1, 0]);
  });

  it('fires active source events only when the path changes', () => {
    const store = new SessionStore(createMemento() as unknown as vscode.Memento, new OutputLogger(createMockOutputChannel()));
    let fired = 0;
    store.onDidChangeActiveSource(() => { fired += 1; });
    store.setActiveSourcePath('/src/main.cpp');
    store.setActiveSourcePath('/src/main.cpp');
    store.setActiveSourcePath(undefined);
    assert.strictEqual(fired, 2);
  });
});
```

（`normalizePath` 在 Windows 上小写，测试用 `\\src\\main.cpp` 覆盖分隔符归一化。）

- [ ] **Step 2: 运行确认失败**：`npm test`（模块不存在报错）
- [ ] **Step 3: 实现 `src/app/sessionStore.ts`**

```ts
import * as vscode from 'vscode';
import { MappingIndex, PresetInfo, TargetInfo, createEmptyMapping } from '../models';
import { OutputLogger } from '../services/outputLogger';
import { normalizePath } from '../utils';

const SELECTED_PRESET_KEY = 'cmakerunner.selectedPreset';

export class SessionStore implements vscode.Disposable {
  private readonly onDidChangePresetsEmitter = new vscode.EventEmitter<void>();
  private readonly onDidChangeTargetsEmitter = new vscode.EventEmitter<void>();
  private readonly onDidChangeActiveSourceEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangePresets = this.onDidChangePresetsEmitter.event;
  public readonly onDidChangeTargets = this.onDidChangeTargetsEmitter.event;
  public readonly onDidChangeActiveSource = this.onDidChangeActiveSourceEmitter.event;

  private presets: PresetInfo[] = [];
  private currentPreset: PresetInfo | undefined;
  private mapping: MappingIndex = createEmptyMapping();
  private activeSourcePath: string | undefined;

  public constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly logger: OutputLogger,
  ) {}

  public getPresets(): readonly PresetInfo[] { return this.presets; }
  public getCurrentPreset(): PresetInfo | undefined { return this.currentPreset; }
  public getActiveSourcePath(): string | undefined { return this.activeSourcePath; }

  public getTargets(): TargetInfo[] {
    return Array.from(this.mapping.targets.values())
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public findTargetsBySource(sourcePath: string): TargetInfo[] {
    const targetIds = this.mapping.sourceToTargets.get(normalizePath(sourcePath)) ?? [];
    return targetIds
      .map((targetId) => this.mapping.targets.get(targetId))
      .filter((target): target is TargetInfo => !!target);
  }

  public async setPresets(presets: readonly PresetInfo[], preferredPresetName?: string): Promise<void> {
    this.presets = [...presets];
    const storedPresetName = preferredPresetName ?? this.workspaceState.get<string>(SELECTED_PRESET_KEY);
    this.currentPreset = this.presets.find((preset) => preset.name === storedPresetName) ?? this.presets[0];
    this.logger.info(`Loaded ${this.presets.length} preset(s). current=${this.currentPreset?.name ?? 'none'}`);

    if (this.currentPreset) {
      await this.workspaceState.update(SELECTED_PRESET_KEY, this.currentPreset.name);
    }

    this.mapping = createEmptyMapping();
    this.onDidChangePresetsEmitter.fire();
    this.onDidChangeTargetsEmitter.fire();
  }

  public async selectPreset(preset: PresetInfo): Promise<void> {
    this.logger.info(`Selecting preset: ${preset.name}`);
    this.currentPreset = preset;
    await this.workspaceState.update(SELECTED_PRESET_KEY, preset.name);
    this.mapping = createEmptyMapping();
    this.onDidChangePresetsEmitter.fire();
    this.onDidChangeTargetsEmitter.fire();
  }

  public setMapping(mapping: MappingIndex): void {
    this.mapping = mapping;
    this.onDidChangeTargetsEmitter.fire();
  }

  public setActiveSourcePath(activeSourcePath: string | undefined): void {
    if (this.activeSourcePath === activeSourcePath) {
      return;
    }
    this.activeSourcePath = activeSourcePath;
    this.onDidChangeActiveSourceEmitter.fire();
  }

  public dispose(): void {
    this.onDidChangePresetsEmitter.dispose();
    this.onDidChangeTargetsEmitter.dispose();
    this.onDidChangeActiveSourceEmitter.dispose();
  }
}
```

- [ ] **Step 4: 验证**: `npm run compile && npm test`（新用例通过）
- [ ] **Step 5: Commit**

```bash
git add src/app/sessionStore.ts test/sessionStore.test.ts
git commit -m "refactor(state): introduce SessionStore as the single source of truth"
```

---

## Task A3：SessionLoader

**Files:**
- Create: `src/app/sessionLoader.ts`
- Create: `test/sessionLoader.test.ts`

- [ ] **Step 1: 先写 `test/sessionLoader.test.ts`（失败）**

覆盖：`ensureInitialized` 只加载一次；`refresh` 使用记忆 preset；无 preset 时清空并告警；过期异步结果被 generation 守卫丢弃。

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionLoader } from '../src/app/sessionLoader';
import { SessionStore } from '../src/app/sessionStore';
import { MappingIndex, PresetInfo, TargetInfo } from '../src/models';
import { OutputLogger } from '../src/services/outputLogger';
import { MappingEngine } from '../src/services/mappingEngine';
import { PresetProvider } from '../src/services/presetProvider';
import { createMockOutputChannel } from './helpers';

describe('session loader', () => {
  const presetA: PresetInfo = { name: 'a', displayName: 'A', binaryDir: '/b/a', sourceDir: '/src' };
  const presetB: PresetInfo = { name: 'b', displayName: 'B', binaryDir: '/b/b', sourceDir: '/src' };

  const createMemento = () => {
    const state = new Map<string, string>();
    return {
      get: (key: string) => state.get(key),
      update: async (key: string, value: string) => { state.set(key, value); },
    } as unknown as vscode.Memento;
  };

  it('loads presets only once for concurrent ensureInitialized calls', async () => {
    let loadCount = 0;
    const presetProvider = { loadPresets: async () => { loadCount += 1; return [presetA]; } } as unknown as PresetProvider;
    const engine = { build: async () => createMapping(undefined) } as unknown as MappingEngine;
    const loader = new SessionLoader(new SessionStore(createMemento(), new OutputLogger(createMockOutputChannel())), presetProvider, engine, new OutputLogger(createMockOutputChannel()));

    await Promise.all([loader.ensureInitialized(), loader.ensureInitialized()]);
    assert.strictEqual(loadCount, 1);
  });

  it('clears targets when no preset is selected', async () => {
    const presetProvider = { loadPresets: async () => [] } as unknown as PresetProvider;
    const engine = { build: async () => createMapping(undefined) } as unknown as MappingEngine;
    const store = new SessionStore(createMemento(), new OutputLogger(createMockOutputChannel()));
    const loader = new SessionLoader(store, presetProvider, engine, new OutputLogger(createMockOutputChannel()));

    await loader.ensureInitialized();
    assert.strictEqual(store.getCurrentPreset(), undefined);
    assert.deepStrictEqual(store.getTargets(), []);
  });

  it('discards stale build results after a newer update starts', async () => {
    const target: TargetInfo = { id: 'a-app', name: 'app', displayName: 'app', type: 'EXECUTABLE', sourceFiles: [], guessedExecutablePath: '/b/a/app' };
    let resolveFirst: ((value: MappingIndex) => void) | undefined;
    const engine = {
      build: (preset: PresetInfo) => preset.name === 'a'
        ? new Promise<MappingIndex>((resolve) => { resolveFirst = resolve; })
        : Promise.resolve(createMapping(target)),
    } as unknown as MappingEngine;
    const presetProvider = { loadPresets: async () => [presetA, presetB] } as unknown as PresetProvider;
    const store = new SessionStore(createMemento(), new OutputLogger(createMockOutputChannel()));
    const loader = new SessionLoader(store, presetProvider, engine, new OutputLogger(createMockOutputChannel()));

    await loader.ensureInitialized();
    await store.selectPreset(presetB);
    await loader.updateTargets();
    resolveFirst?.(createMapping(target));
    await Promise.resolve();

    assert.deepStrictEqual(store.getTargets().map((item) => item.id), ['a-app']);
  });
});

function createMapping(target: TargetInfo | undefined): MappingIndex {
  return {
    targets: target ? new Map([[target.id, target]]) : new Map(),
    sourceToTargets: new Map(),
  };
}
```

注：第一个用例的引擎返回空映射；第三个用例验证 `selectPreset(B)` 后旧 A 的挂起结果不会覆盖 B 的结果。

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 `src/app/sessionLoader.ts`**

```ts
import { createEmptyMapping } from '../models';
import { MappingEngine } from '../services/mappingEngine';
import { OutputLogger } from '../services/outputLogger';
import { PresetProvider } from '../services/presetProvider';
import { SessionStore } from './sessionStore';

export class SessionLoader {
  private initializationPromise?: Promise<void>;
  private targetGeneration = 0;

  public constructor(
    private readonly store: SessionStore,
    private readonly presetProvider: PresetProvider,
    private readonly mappingEngine: MappingEngine,
    private readonly logger: OutputLogger,
  ) {}

  public async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.refresh().catch((error) => {
        this.initializationPromise = undefined;
        throw error;
      });
    }

    return this.initializationPromise;
  }

  public async refresh(preferredPresetName?: string): Promise<void> {
    const presets = await this.presetProvider.loadPresets();
    await this.store.setPresets(presets, preferredPresetName);
    await this.updateTargets();
  }

  public async updateTargets(): Promise<void> {
    const preset = this.store.getCurrentPreset();
    if (!preset) {
      this.logger.warn('Skipping target update because no preset is selected');
      this.store.setMapping(createEmptyMapping());
      return;
    }

    this.logger.info(
      `Updating targets. preset=${preset.name}, activeSource=${this.store.getActiveSourcePath() ?? 'none'}`,
    );
    const generation = ++this.targetGeneration;
    const mapping = await this.mappingEngine.build(preset);

    if (generation !== this.targetGeneration || this.store.getCurrentPreset()?.name !== preset.name) {
      this.logger.info(`Discarding stale target mapping result for preset ${preset.name}`);
      return;
    }

    this.store.setMapping(mapping);
  }
}
```

- [ ] **Step 4: 验证**: `npm run compile && npm test`
- [ ] **Step 5: Commit**

```bash
git add src/app/sessionLoader.ts test/sessionLoader.test.ts
git commit -m "refactor(state): add SessionLoader for lazy init and target refresh"
```

---

## Task A4：提取 TargetPicker、BuildDirectoryCleaner、formatDuration

**Files:**
- Create: `src/ui/targetPicker.ts`
- Create: `src/services/buildDirectoryCleaner.ts`
- Modify: `src/utils.ts`
- Modify: `src/services/workflowManager.ts`

- [ ] **Step 1: `src/utils.ts` 追加**

```ts
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
}
```

- [ ] **Step 2: `src/services/workflowManager.ts` 删除本地 `formatDuration`，改为 `import { formatDuration, quoteForPowerShell, quoteForShell } from '../utils';`**
- [ ] **Step 3: 创建 `src/services/buildDirectoryCleaner.ts`**

把原 `extension.ts:214-268` 的 `clearPresetBuildDirectory` 原样迁移为导出函数：

```ts
export async function clearPresetBuildDirectory(preset: PresetInfo, logger: OutputLogger): Promise<boolean> { ... }
```

- [ ] **Step 4: 创建 `src/ui/targetPicker.ts`**

迁移原 `extension.ts` 的 quick pick 逻辑，类形式：

```ts
export interface TargetQuickPickItem extends vscode.QuickPickItem { readonly target?: TargetInfo; }
type RegexFilterQuickPickItem = vscode.QuickPickItem & { readonly regexText: string };
export type RegexFilterPick<T extends vscode.QuickPickItem> =
  | { readonly type: 'item'; readonly item: T }
  | { readonly type: 'regex'; readonly filterText: string };

export class TargetPicker {
  public constructor(
    private readonly store: SessionStore,
    private readonly logger: OutputLogger,
    private readonly workspaceRoot: string,
  ) {}

  public async pickTarget(options?: { userActiveFile?: boolean }): Promise<TargetQuickPickItem | undefined>
  public async pickTargetFilter(): Promise<RegexFilterPick<TargetQuickPickItem> | undefined>
  private getAutoFilteredTargets(userActiveFile: boolean): TargetInfo[]
  private createTargetQuickPickItems(targets: readonly TargetInfo[]): TargetQuickPickItem[]
  private ensureDiscoveredTargets(targets: TargetInfo[]): boolean
  private async pickRegexFilter<T extends vscode.QuickPickItem>(...): Promise<RegexFilterPick<T> | undefined>
}
```

关键差异：`getAutoFilteredTargets` 改从 `store.getTargets()` / `store.findTargetsBySource()` 取数；`getActiveEditorFilePath`（scheme === 'file'）作为文件内私有函数；`ensureDiscoveredTargets` 用 `store.getCurrentPreset()` 生成提示。

- [ ] **Step 5: 验证**: `npm run compile && npm test`（行为不变，全绿）
- [ ] **Step 6: Commit**

```bash
git add src/ui/targetPicker.ts src/services/buildDirectoryCleaner.ts src/utils.ts src/services/workflowManager.ts
git commit -m "refactor(ui): extract target picker, build directory cleaner, and formatDuration"
```

---

## Task A5：PresetsView / TargetsView 封装

**Files:**
- Create: `src/ui/presetsView.ts`
- Create: `src/ui/targetsView.ts`

- [ ] **Step 1: `src/ui/presetsView.ts`**

```ts
export class PresetsView implements vscode.Disposable {
  private readonly provider = new PresetTreeDataProvider();
  private readonly view: vscode.TreeView<PresetTreeItem>;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly store: SessionStore, private readonly logger: OutputLogger) {
    this.view = vscode.window.createTreeView('cmakerunner.presets', {
      treeDataProvider: this.provider,
      showCollapseAll: false,
    });
    this.refresh();
    this.disposables.push(store.onDidChangePresets(() => this.refresh()), this.view);
  }

  public get visible(): boolean { return this.view.visible; }

  public onDidChangeVisibility(listener: () => void): vscode.Disposable | undefined {
    if (!('onDidChangeVisibility' in this.view)) { return undefined; }
    return this.view.onDidChangeVisibility(() => listener());
  }

  public async reveal(presetName: string): Promise<void> {
    const item = this.provider.findItem(presetName);
    if (!item) { return; }
    try {
      await this.view.reveal(item, { select: true, focus: false });
    } catch { /* ignore */ }
  }

  public dispose(): void { for (const disposable of this.disposables) { disposable.dispose(); } }

  private refresh(): void {
    this.provider.setPresets([...this.store.getPresets()], this.store.getCurrentPreset()?.name);
  }
}
```

- [ ] **Step 2: `src/ui/targetsView.ts`**

```ts
export class TargetsView implements vscode.Disposable {
  private readonly provider = new TargetTreeDataProvider();
  private readonly view: vscode.TreeView<TargetTreeItem | SourceTreeItem>;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly store: SessionStore,
    private readonly workspaceRoot: string,
    private readonly logger: OutputLogger,
  ) {
    this.view = vscode.window.createTreeView('cmakerunner.targets', {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.refreshTargets();
    this.disposables.push(
      store.onDidChangeTargets(() => this.refreshTargets()),
      store.onDidChangeActiveSource(() => {
        this.provider.setActiveSourcePath(store.getActiveSourcePath());
        void this.revealActiveSource(store.getActiveSourcePath());
      }),
      this.view,
    );
  }

  public get visible(): boolean { return this.view.visible; }
  public onDidChangeVisibility(listener: () => void): vscode.Disposable | undefined { /* 同 PresetsView */ }
  public getFilterText(): string { return this.provider.getFilterText(); }
  public getVisibleTargetCount(): number { return this.provider.getVisibleTargetCount(); }

  public async applyFilter(filterText: string, options?: { isRegex?: boolean }): Promise<void> {
    this.provider.setFilterText(filterText, options);
    await this.updateViewState();
  }

  public async revealTarget(targetId: string): Promise<void> {
    const item = this.provider.findTargetItem(targetId);
    if (!item) { return; }
    try { await this.view.reveal(item, { select: true, focus: false, expand: false }); } catch { /* ignore */ }
  }

  private refreshTargets(): void {
    this.provider.setTargets(
      this.store.getTargets(),
      this.store.getCurrentPreset()?.sourceDir ?? this.workspaceRoot,
      this.store.getActiveSourcePath(),
    );
    void this.updateViewState();
  }

  private async revealActiveSource(filePath: string | undefined): Promise<void> {
    if (!filePath || !this.view.visible) { return; }
    const sourceItem = this.provider.findFirstSourceItemByFile(filePath);
    if (!sourceItem) {
      this.logger.info(`Active file is not present in target tree: ${filePath}`);
      return;
    }
    try {
      await this.view.reveal(sourceItem, { select: false, focus: false, expand: false });
    } catch (error) {
      this.logger.warn(`Unable to reveal active source ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async updateViewState(): Promise<void> {
    const filterText = this.provider.getFilterText();
    this.view.description = filterText
      ? `${this.provider.isFilterRegex() ? 'Regex' : 'Filter'}: ${filterText}`
      : undefined;
    this.view.message = filterText && this.provider.getVisibleTargetCount() === 0
      ? 'No executable target matches the current filter.'
      : undefined;
    await vscode.commands.executeCommand('setContext', 'cmakerunner.targetsFilterActive', !!filterText);
  }

  public dispose(): void { for (const disposable of this.disposables) { disposable.dispose(); } }
}
```

- [ ] **Step 3: 验证**: `npm run compile && npm test`（此时 views 尚未接入 activate，扩展测试可能仍绿）
- [ ] **Step 4: Commit**

```bash
git add src/ui/presetsView.ts src/ui/targetsView.ts
git commit -m "refactor(ui): encapsulate preset and target tree views"
```

---

## Task A6：命令拆分 + TestController 订阅 + extension 瘦身

**Files:**
- Create: `src/app/commandGuards.ts`
- Create: `src/app/commands/types.ts`
- Create: `src/app/commands/presetCommands.ts`
- Create: `src/app/commands/targetCommands.ts`
- Create: `src/app/commands/viewCommands.ts`
- Modify: `src/services/testController.ts`
- Modify: `src/extension.ts`
- Modify: `test/extension.test.ts`（如需）

- [ ] **Step 1: `src/app/commandGuards.ts`**

```ts
export function ensurePreset(store: SessionStore, logger: OutputLogger): PresetInfo | undefined { ...原 ensurePreset 逻辑... }
export function getTargetType(target: TargetInfo): string { return target.type ?? 'EXECUTABLE'; }
export function isRunnableTarget(target: TargetInfo): boolean { return getTargetType(target) === 'EXECUTABLE'; }
export function ensureRunnableTarget(target: TargetInfo, action: string): boolean { ...原逻辑... }
```

- [ ] **Step 2: `src/app/commands/types.ts`**

```ts
export interface CommandContext {
  readonly store: SessionStore;
  readonly sessionLoader: SessionLoader;
  readonly workflowManager: WorkflowManager;
  readonly testController: GTestTestController;
  readonly presetsView: PresetsView;
  readonly targetsView: TargetsView;
  readonly targetPicker: TargetPicker;
  readonly logger: OutputLogger;
}
```

- [ ] **Step 3: 三个命令模块**

- `viewCommands.ts`：`refresh`（`ensureInitialized` → `refresh(store.getCurrentPreset()?.name)`）、`filterTargets`、`clearTargetFilter`、`refreshGTests`。
- `presetCommands.ts`：`selectPreset`（quick pick / TreeItem）、`buildPreset`、`rebuildPreset`（`clearPresetBuildDirectory` → build → `sessionLoader.updateTargets()` → `showPresetBuildSuccess`）。内部 `selectPreset` 调用 `store.selectPreset` + `presetsView.reveal`。
- `targetCommands.ts`：`buildTarget`、`buildTargetFromCurrentFile`、`runTarget`、`debugTarget`；`resolveTargetFromArgument` 改为 `store.findTargetsBySource`；`ensureRunnableTarget` 来自 commandGuards；选中/过滤用 `targetsView.revealTarget` / `targetsView.applyFilter`。

每个模块导出 `registerXxxCommands(context: CommandContext): vscode.Disposable[]`。

- [ ] **Step 4: 修改 `src/services/testController.ts`**

```ts
public constructor(
  private readonly store: SessionStore,
  private readonly configurationManager: ConfigurationManager,
  private readonly logger: OutputLogger,
  private readonly debugSessionManager: DebugSessionManager,
  private readonly ensureInitialized?: () => Promise<void>,
) {
  // ...createTestController/resolveHandler/run profiles 不变...
  this.disposables.push(store.onDidChangeTargets(() => this.reset()));
}
```

- 删除 `preset`、`targets` 字段与 `setPreset()`/`setTargets()`；`discoverExecutables()` 用 `this.store.getCurrentPreset()`；`getExecutableCandidates()` 用 `this.store.getTargets()`；`dispose()` 释放 `disposables`。

- [ ] **Step 5: 重写 `src/extension.ts` 为组装层**

```ts
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return; }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const outputChannel = vscode.window.createOutputChannel('CMake Runner');
  const logger = new OutputLogger(outputChannel);
  const configurationManager = new ConfigurationManager();
  const store = new SessionStore(context.workspaceState, logger);
  const presetProvider = new PresetProvider(workspaceRoot, logger);
  const mappingEngine = new MappingEngine(logger);
  const sessionLoader = new SessionLoader(store, presetProvider, mappingEngine, logger);
  const taskExecutionEngine = new TaskExecutionEngine(workspaceRoot, configurationManager, logger);
  const debugSessionManager = new DebugSessionManager();
  const testController = new GTestTestController(store, configurationManager, logger, debugSessionManager, () => sessionLoader.ensureInitialized());
  const workflowManager = new WorkflowManager(configurationManager, taskExecutionEngine, logger, debugSessionManager, () => testController.discover());
  const presetsView = new PresetsView(store, logger);
  const targetsView = new TargetsView(store, workspaceRoot, logger);
  const targetPicker = new TargetPicker(store, logger, workspaceRoot);

  const commandContext: CommandContext = { store, sessionLoader, workflowManager, testController, presetsView, targetsView, targetPicker, logger };

  logger.info(`Extension activated for workspace: ${workspaceRoot}`);
  context.subscriptions.push(
    outputChannel,
    store,
    presetsView,
    targetsView,
    testController,
    debugSessionManager,
    ...registerViewCommands(commandContext),
    ...registerPresetCommands(commandContext),
    ...registerTargetCommands(commandContext),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const documentUri = editor?.document.uri;
      store.setActiveSourcePath(documentUri?.scheme === 'file' ? documentUri.fsPath : undefined);
    }),
  );

  store.setActiveSourcePath(getInitialActiveSource(workspaceRoot)); // 主动画制器文件，保持旧行为

  const onVisible = async (): Promise<void> => { await sessionLoader.ensureInitialized(); };
  const presetsVisibility = presetsView.onDidChangeVisibility(() => { if (presetsView.visible) { void onVisible(); } });
  const targetsVisibility = targetsView.onDidChangeVisibility(() => { if (targetsView.visible) { void onVisible(); } });
  if (presetsVisibility) { context.subscriptions.push(presetsVisibility); }
  if (targetsVisibility) { context.subscriptions.push(targetsVisibility); }

  if (presetsView.visible || targetsView.visible) {
    void onVisible();
  }
}
```

`getInitialActiveSource` 为文件内小函数（`activeTextEditor` + scheme 检查）。

- [ ] **Step 6: 验证**

```bash
npm run compile && npm test
wc -l src/extension.ts        # ≤ 200
grep -rn "setPreset\|setTargets" src/ || true   # 仅 targetTreeDataProvider.setTargets 的合法调用
```

- [ ] **Step 7: Commit**

```bash
git add src/app src/services/testController.ts src/extension.ts test/extension.test.ts
git commit -m "refactor(extension): split commands and wire views through SessionStore"
```

---

## Task A7：阶段 A 收尾验证

- [ ] `npm run compile && npm test && npm run test:coverage`
- [ ] `git status` 干净；必要时调整测试
- [ ] Commit（如无改动则跳过）

---

## Task C1：processRunner

**Files:**
- Create: `src/services/processRunner.ts`
- Create: `test/processRunner.test.ts`

- [ ] **Step 1: 先写 `test/processRunner.test.ts`（失败）**

用例：stdout/exit code；非零退出 → exitCode 3；`timeoutMs: 300` + 长眠脚本 → `timedOut`；token 取消 → `cancelled`（见设计文档；用 `process.execPath -e` 保持跨平台）。

- [ ] **Step 2: 实现 `src/services/processRunner.ts`**

```ts
import { execFile, spawn } from 'child_process';
import * as vscode from 'vscode';

export interface ProcessResult {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly error?: Error;
}

export interface ProcessOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly token?: vscode.CancellationToken;
  readonly maxBuffer?: number;
  readonly killGraceMs?: number;
}

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2000;

export function runProcess(file: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined;
    const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let cancellationListener: vscode.Disposable | undefined;

    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
      (error, stdout, stderr) => {
        if (settled) { return; }
        settled = true;
        if (timeoutHandle) { clearTimeout(timeoutHandle); }
        if (killTimer) { clearTimeout(killTimer); }
        cancellationListener?.dispose();
        const nodeError = error as NodeJS.ErrnoException | null;
        const exitCode = typeof nodeError?.code === 'number' ? nodeError.code : error ? 1 : 0;
        resolve({ exitCode, stdout, stderr, timedOut, cancelled, error: error ?? undefined });
      },
    );

    const killProcessTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) { return; }
      if (process.platform === 'win32') {
        try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* ignore */ }
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* ignore */ }
      }
    };

    const terminate = (): void => {
      killProcessTree('SIGTERM');
      killTimer = setTimeout(() => killProcessTree('SIGKILL'), killGraceMs);
    };

    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    }

    if (options.token) {
      if (options.token.isCancellationRequested) {
        cancelled = true;
        terminate();
      } else {
        cancellationListener = options.token.onCancellationRequested(() => { cancelled = true; terminate(); });
      }
    }
  });
}
```

- [ ] **Step 3: 验证**: `npm run compile && npm test`
- [ ] **Step 4: Commit**

```bash
git add src/services/processRunner.ts test/processRunner.test.ts
git commit -m "feat(testing): add cancellable process runner with timeout and tree kill"
```

---

## Task C2：超时设置项

**Files:**
- Modify: `src/services/configurationManager.ts`
- Modify: `package.json`（contributes.configuration.properties）
- Modify: `test/services.test.ts`

- [ ] **Step 1: 测试先行（`test/services.test.ts` 增加 3 个用例：默认 60000、0 保留、负数/非数字回退 60000）**
- [ ] **Step 2: 实现**

```ts
public getGTestCaseTimeoutMs(): number {
  const value = this.settings().get<number>('gtests.caseTimeoutMs', 60000);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 60000;
  }

  return value;
}
```

- [ ] **Step 3: `package.json` 增加设置项**

```json
"cmakerunner.gtests.caseTimeoutMs": {
  "type": "number",
  "default": 60000,
  "description": "Per-test-case timeout in milliseconds for Test Explorer GoogleTest runs. Use 0 to disable the timeout."
}
```

- [ ] **Step 4: 验证 + Commit**

```bash
git add src/services/configurationManager.ts package.json test/services.test.ts
git commit -m "feat(testing): add configurable per-case timeout setting"
```

---

## Task C3：run/debug 接入超时与取消

**Files:**
- Modify: `src/services/testController.ts`
- Modify: `test/testController.test.ts`
- Modify: `test/vscode-mock.js`（补 `debug.stopDebugging`）

- [ ] **Step 1: `run()` 重写**

- 删除本地 `execFileResult` 与 `ExecResult`，导入 `runProcess`/`ProcessResult`；`listExecutableCases` 使用 `runProcess(..., { cwd, timeoutMs: 15000 })`。
- `run()` 按设计执行：超时 → `run.failed(item, new vscode.TestMessage(\`Timed out after ${formatDuration(timeoutMs)}.\`), duration)` 并继续；取消 → `run.skipped(item)` 后 `continue`（后续循环 token 检查补 skipped）；`run.end()` 放 `finally`。
- `debug()`：`const cancellationListener = token.onCancellationRequested(() => { void vscode.debug.stopDebugging(); });`，`finally` 中 dispose 并 `run.end()`。

- [ ] **Step 2: `test/testController.test.ts` 增加运行分支测试**

patch `require('../src/services/processRunner').runProcess`：
- 首次调用（list）返回 `{ exitCode: 0, stdout: 'Suite.\n  Case\n', ... }`；
- 第二次（run）返回 `timedOut: true` → 断言 TestRun 记录到 `failed` 且消息含 `Timed out`；
- 另起场景返回 `cancelled: true` → 断言 `skipped`。

测试通过重写 `(controller as any).createTestRun` 捕获调用记录。

- [ ] **Step 3: 验证**: `npm run compile && npm test`
- [ ] **Step 4: Commit**

```bash
git add src/services/testController.ts test/testController.test.ts test/vscode-mock.js
git commit -m "feat(testing): enforce per-case timeouts and support cancelling test runs"
```

---

## Task D1：文档与版本

**Files:**
- Modify: `doc/architecture-overview.zh-CN.md`（§4、§6.4、§7、§10.3、§13）
- Modify: `README-ALL.md`、`doc/README.zh-CN.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`（version 0.5.0）

- [ ] 更新架构文档：扩展入口改为组装层；新增 `src/app/` 说明；§6.4 改为"build() 无状态、空结果清空"；§7 增加 `gtests.caseTimeoutMs`；§10.3 描述超时/取消语义；§13 数据流更新为 store 事件驱动。
- [ ] README 增加超时设置与状态行为说明。
- [ ] AGENTS.md：Project Structure 增加 `src/app/`；Key Details 补充测试超时设置。
- [ ] CHANGELOG 顶部新增 `## V0.5.0 2026-09-16`；`package.json` version → 0.5.0。
- [ ] 验证 + Commit

```bash
npm run compile && npm test
git add doc README-ALL.md AGENTS.md CHANGELOG.md package.json
git commit -m "docs(release): V0.5.0 architecture refactor and test robustness"
```

---

## Task D2：最终验证

- [ ] `npm run compile && npm test && npm run test:coverage && npm run package:vsix`
- [ ] `git status` 干净；`git log --oneline -12` 逐提交复核
- [ ] 汇总：测试套件数、用例数、覆盖率摘要、`extension.ts` 行数
