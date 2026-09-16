# GoogleTest 发现规则优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让 GoogleTest 候选可执行文件的筛选从固定 `test*` 前缀改为可配置 glob 模式；用户设置后完全替换默认规则。

**Architecture:** `ConfigurationManager` 新增 `getGTestExecutablePatterns()` 负责读取、校验与回退默认 `["test*"]`；`GTestTestController` 用纯函数 `matchesGTestExecutableName()` 筛选候选可执行文件。`--gtest_list_tests` 探测、用例注册、run/debug、源码位置补全全部不变。

**Tech Stack:** TypeScript / VS Code Extension API / Mocha / c8 / 自研 vscode-mock。`npm test` = tsc 编译到 `out/` + `test/run-unit.js`（`test/vscode-mock.js` 注入 mock）。

**执行环境:** 仓库目录，当前分支 `refactor/v0.5.0-architecture`（不切换、不新建分支），每个 Task 一个提交。

---

## 文件结构

```text
Create: docs/superpowers/specs/2026-09-16-gtest-discovery-rules-design.md
Create: docs/superpowers/plans/2026-09-16-gtest-discovery-rules.md
Modify: src/services/configurationManager.ts   getGTestExecutablePatterns + DEFAULT_GTEST_EXECUTABLE_PATTERNS
Modify: src/services/testController.ts         matchesGTestExecutableName + getExecutableCandidates 接入
Modify: package.json                           gtests.executablePatterns + version 0.5.1
Modify: test/services.test.ts                  设置读取用例
Modify: test/testController.test.ts            matcher 用例 + 发现级用例
Modify: README.md / README-ALL.md / doc/README.zh-CN.md / AGENTS.md
Modify: doc/architecture-overview.zh-CN.md / CHANGELOG.md
```

---

## Task 0：基线与文档

**Files:**
- Create: `docs/superpowers/specs/2026-09-16-gtest-discovery-rules-design.md`
- Create: `docs/superpowers/plans/2026-09-16-gtest-discovery-rules.md`

- [x] **Step 1: 基线验证**

```bash
npm run compile && npm test
```

Expected: 全绿（记录 passing 数量作为基线）。

- [x] **Step 2: 提交设计文档与计划**

```bash
git add docs/superpowers/specs/2026-09-16-gtest-discovery-rules-design.md docs/superpowers/plans/2026-09-16-gtest-discovery-rules.md
git commit -m "docs: add gtest discovery rules plan"
```

---

## Task 1：设置读取与匹配默认值

**Files:**
- Modify: `src/services/configurationManager.ts`
- Modify: `package.json`
- Test: `test/services.test.ts`

- [x] **Step 1: 写失败测试（`test/services.test.ts` 的 `describe('ConfigurationManager')` 内新增 3 个用例）**

```ts
    it('should default GoogleTest executable patterns to the test prefix', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({});

      const manager = new ConfigurationManager();
      assert.deepStrictEqual([...manager.getGTestExecutablePatterns()], ['test*']);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should use configured GoogleTest executable patterns', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({
        'gtests.executablePatterns': ['*_test', ' MathTest '],
      });

      const manager = new ConfigurationManager();
      assert.deepStrictEqual([...manager.getGTestExecutablePatterns()], ['*_test', 'MathTest']);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should fall back to the default pattern for invalid pattern settings', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;

      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.executablePatterns': ['', 42] });
      assert.deepStrictEqual([...new ConfigurationManager().getGTestExecutablePatterns()], ['test*']);

      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.executablePatterns': 'test*' });
      assert.deepStrictEqual([...new ConfigurationManager().getGTestExecutablePatterns()], ['test*']);

      vscode.workspace.getConfiguration = originalGetConfig;
    });
```

- [x] **Step 2: 运行测试确认失败**

```bash
npm run compile && npx mocha out/test/services.test.js
```

Expected: FAIL `manager.getGTestExecutablePatterns is not a function`。

- [x] **Step 3: 实现**

`src/services/configurationManager.ts` 顶部新增导出常量：

```ts
export const DEFAULT_GTEST_EXECUTABLE_PATTERNS: readonly string[] = ['test*'];
```

`ConfigurationManager` 内、`getGTestCaseTimeoutMs()` 之后新增：

```ts
  public getGTestExecutablePatterns(): readonly string[] {
    const value = this.settings().get<unknown>('gtests.executablePatterns', [...DEFAULT_GTEST_EXECUTABLE_PATTERNS]);
    if (!Array.isArray(value)) {
      return DEFAULT_GTEST_EXECUTABLE_PATTERNS;
    }

    const patterns = value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    return patterns.length > 0 ? patterns : DEFAULT_GTEST_EXECUTABLE_PATTERNS;
  }
```

- [x] **Step 4: `package.json` 新增设置项（放在 `cmakerunner.gtests.caseTimeoutMs` 之后）**

```json
                "cmakerunner.gtests.executablePatterns": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "default": [
                        "test*"
                    ],
                    "markdownDescription": "Glob patterns matched against the GoogleTest executable file name without its extension. Supports `*` and `?`. Patterns containing uppercase letters are case-sensitive; others are case-insensitive. When set, these patterns replace the default `test*` rule. Candidate executables are still confirmed with `--gtest_list_tests`."
                },
```

- [x] **Step 5: 验证**

```bash
npm run compile && npx mocha out/test/services.test.js
```

Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add src/services/configurationManager.ts package.json test/services.test.ts
git commit -m "feat(testing): add configurable gtest executable patterns setting"
```

---

## Task 2：候选筛选接入

**Files:**
- Modify: `src/services/testController.ts`
- Test: `test/testController.test.ts`

- [x] **Step 1: 写失败测试（替换 `test/testController.test.ts` 的 `describe('isTestNamedExecutable')` 整块，并更新 import）**

import 行改为：

```ts
import { GTestTestController, matchesGTestExecutableName } from '../src/services/testController';
```

新增 `describe('matchesGTestExecutableName')`：

```ts
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
```

- [x] **Step 2: 运行测试确认失败**

```bash
npm run compile && npx mocha out/test/testController.test.js
```

Expected: FAIL（`matchesGTestExecutableName` 未定义 / 导入报错）。

- [x] **Step 3: 实现 `src/services/testController.ts`**

删除导出的 `isTestNamedExecutable`，新增：

```ts
export function matchesGTestExecutableName(filePath: string, patterns: readonly string[]): boolean {
  const executableName = path.basename(filePath, path.extname(filePath));
  return patterns.some((pattern) => matchesGlob(executableName, pattern));
}

function matchesGlob(value: string, pattern: string): boolean {
  const flags = /[A-Z]/.test(pattern) ? '' : 'i';
  return new RegExp(`^${globToRegExpSource(pattern)}$`, flags).test(value);
}

function globToRegExpSource(pattern: string): string {
  let source = '';
  for (const character of pattern) {
    if (character === '*') {
      source += '.*';
    } else if (character === '?') {
      source += '.';
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return source;
}
```

`getExecutableCandidates()` 中把：

```ts
      if (!isTestNamedExecutable(executablePath)) {
        continue;
      }
```

替换为：

```ts
      if (!matchesGTestExecutableName(executablePath, patterns)) {
        continue;
      }
```

并在方法体开头（`const seen` 之前）取值：

```ts
    const patterns = this.configurationManager.getGTestExecutablePatterns();
```

- [x] **Step 4: 写发现级测试（`test/testController.test.ts`）**

把 `createController` 改为可注入目标与模式：

```ts
    const createController = async (options?: {
      readonly patterns?: readonly string[];
      readonly targets?: readonly { readonly id: string; readonly name: string; readonly path: string }[];
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
```

fixture 新增 `unit` 可执行文件（与现有 `before`/`after` 一致）：

```ts
    const unitExecutableName = process.platform === 'win32' ? 'unit_math.exe' : 'unit_math';
    const unitExecutablePath = path.join(fixtureRoot, unitExecutableName);
```

`before` 中增加：

```ts
      fs.writeFileSync(unitExecutablePath, '');
```

新增 `describe('discover')`（放在 `describe('run')` 之前，可独立 stub `runProcess`）：

```ts
  describe('discover', () => {
    const mockedVscode = vscode as typeof vscode & {
      __mock: { readonly createdTestControllers: Map<string, unknown> };
    };
    const fixtureRoot = path.join(os.tmpdir(), `cmakerunner-test-controller-${process.pid}`);
    const namedExecutableName = process.platform === 'win32' ? 'test_fake_app.exe' : 'test_fake_app';
    const namedExecutablePath = path.join(fixtureRoot, namedExecutableName);
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
      fs.writeFileSync(namedExecutablePath, '');
      fs.writeFileSync(unitExecutablePath, '');
    });

    after(() => {
      processRunnerModule.runProcess = originalRunProcess;
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    const createController = async (options?: {
      readonly patterns?: readonly string[];
      readonly targets?: readonly { readonly id: string; readonly name: string; readonly path: string }[];
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
      const targetDefinitions = options?.targets ?? [{ id: 'named', name: namedExecutableName, path: namedExecutablePath }];
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

    it('probes only executables matching the default test prefix', async () => {
      const probed: string[] = [];
      processRunnerModule.runProcess = async (file) => {
        probed.push(file);
        return listResult;
      };
      const controller = await createController({
        targets: [
          { id: 'named', name: namedExecutableName, path: namedExecutablePath },
          { id: 'unit', name: unitExecutableName, path: unitExecutablePath },
        ],
      });

      await controller.discover();

      assert.deepStrictEqual(probed, [namedExecutablePath]);
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
          { id: 'named', name: namedExecutableName, path: namedExecutablePath },
          { id: 'unit', name: unitExecutableName, path: unitExecutablePath },
        ],
      });

      await controller.discover();

      assert.deepStrictEqual(probed, [unitExecutablePath]);
    });
  });
```

- [x] **Step 5: 验证**

```bash
npm run compile && npm test
```

Expected: 全绿。

- [x] **Step 6: Commit**

```bash
git add src/services/testController.ts test/testController.test.ts
git commit -m "feat(testing): filter gtest candidates with configurable name patterns"
```

---

## Task 3：文档与版本

**Files:**
- Modify: `README.md`、`README-ALL.md`、`doc/README.zh-CN.md`
- Modify: `AGENTS.md`、`doc/architecture-overview.zh-CN.md`
- Modify: `CHANGELOG.md`、`package.json`（version 0.5.1）

- [x] **Step 1: 更新 README 的发现规则描述**

把「file name starts with `test` (case-insensitive)」相关句子改为：默认按 `test*` 前缀（大小写不敏感）筛选，可用 `cmakerunner.gtests.executablePatterns` 配置 glob 模式（`*`/`?`，含大写字母区分大小写）且配置后替换默认规则；探测确认逻辑不变。

- [x] **Step 2: 设置表新增一行**

```markdown
| `cmakerunner.gtests.executablePatterns` | `["test*"]` | Glob patterns for GoogleTest candidate executable names; replaces the default rule when set. |
```

`doc/README.zh-CN.md` 对应中文说明。

- [x] **Step 3: 更新 AGENTS.md Key Details**

把「whose executable file name starts with `test`」改为「whose executable file name matches `cmakerunner.gtests.executablePatterns` (default `test*`)」。

- [x] **Step 4: 更新 `doc/architecture-overview.zh-CN.md`**

设置清单（§7 附近）与 §10/§13.5 的发现流程描述同步为「命名模式（默认 `test*`，可配置替换）→ `--gtest_list_tests` 确认」。

- [x] **Step 5: CHANGELOG 新增 V0.5.1 与 version**

```markdown
## V0.5.1 2026-09-16
### Enhancements
* Add `cmakerunner.gtests.executablePatterns` to customize which executable names are probed for GoogleTest cases; the default is `test*` (case-insensitive) and configured patterns replace it, with `*`/`?` wildcards and case-sensitive matching for patterns containing uppercase letters
```

`package.json` → `"version": "0.5.1"`。

- [x] **Step 6: Commit**

```bash
git add README.md README-ALL.md doc/README.zh-CN.md AGENTS.md doc/architecture-overview.zh-CN.md CHANGELOG.md package.json
git commit -m "docs: describe configurable gtest discovery patterns (v0.5.1)"
```

---

## Task 4：最终验证

- [x] **Step 1: 全量测试**

```bash
npm run compile && npm test
```

Expected: 全绿。

- [x] **Step 2: 覆盖率**

```bash
npm run test:coverage
```

Expected: 正常输出覆盖率报告，无失败用例。

- [x] **Step 3: 打包**

```bash
npm run package:vsix
```

Expected: `dist/` 生成 VSIX。

- [x] **Step 4: 检查旧描述残留**

```bash
rg -n "starts with .?test|以 .?test 开头" README.md README-ALL.md doc AGENTS.md
```

Expected: 无匹配。
