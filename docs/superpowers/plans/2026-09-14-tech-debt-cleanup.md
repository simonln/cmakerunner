# V0.4.9 技术债清理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除 V0.4.0 GoogleTest 迁移遗留的死代码与过期编译产物，让全部测试套件真正跑起来，并同步文档与版本号到 V0.4.9。

**Architecture:** 按主题分为 9 个可独立回滚的提交；先抽出 `parseGTestListOutput` 到独立模块，再删除其旧宿主，保证每一步都可编译、测试全绿。

**Tech Stack:** TypeScript / Mocha / c8 / VS Code 扩展。`npm test` = `tsc` 编译到 `out/` + `test/run-unit.js`；测试通过 `test/vscode-mock.js` 注入 VS Code mock。

**执行环境:** 当前仓库目录，分支 `cleanup/v0.4.9-tech-debt`，每个 Task 一个提交，不推送、不合并。

---

## Task 0：准备分支与基线

**Files:** 无代码改动（仅提交本计划文件）

- [ ] 基于 `main` 创建分支：`git checkout -b cleanup/v0.4.9-tech-debt`
- [ ] 提交本计划文件：`git add docs/superpowers/plans/2026-09-14-tech-debt-cleanup.md && git commit -m "docs: add v0.4.9 tech debt cleanup plan"`
- [ ] 记录基线：`npm run compile && npm test`（应全绿），并记录通过的套件与用例数
- [ ] 若基线失败，停止并报告，不继续执行

---

## Task 1：抽出 `parseGTestListOutput` 到独立模块

**Files:**
- Create: `src/services/gtestParser.ts`
- Create: `test/gtestParser.test.ts`
- Modify: `src/services/testController.ts:9`
- Modify: `src/services/workflowManager.ts:494-523`（删除本地函数，改为导入）
- Modify: `test/workflow.test.ts`（删除 244-258 用例，更新第 8 行导入）

**背景:** `parseGTestListOutput` 目前定义在 `workflowManager.ts`，但生产环境只有 `testController.ts` 使用它。Task 2 会删除 WorkflowManager 的其余 gtest 路径，所以先把它搬到独立模块。

- [ ] **Step 1: 新建 `src/services/gtestParser.ts`**，内容为从 `workflowManager.ts:494-523` 原样搬迁的函数：

```ts
import { GTestCaseInfo } from '../models';

export function parseGTestListOutput(output: string): GTestCaseInfo[] {
  const testCases: GTestCaseInfo[] = [];
  let currentSuite = '';

  for (const line of output.split(/\r?\n/)) {
    const withoutComment = line.replace(/\s+#.*$/, '').trimEnd();
    if (!withoutComment.trim()) {
      continue;
    }

    if (!/^\s/.test(withoutComment) && withoutComment.endsWith('.')) {
      currentSuite = withoutComment.slice(0, -1).trim();
      continue;
    }

    const testName = withoutComment.trim();
    if (!currentSuite || !testName) {
      continue;
    }

    const filter = `${currentSuite}.${testName}`;
    testCases.push({
      suite: currentSuite,
      name: testName,
      filter,
    });
  }

  return testCases;
}
```

- [ ] **Step 2: 新建 `test/gtestParser.test.ts`**，搬迁 `workflow.test.ts:244-258` 的用例并补充空输入用例：

```ts
import * as assert from 'assert';
import { parseGTestListOutput } from '../src/services/gtestParser';

describe('gtest parser', () => {
  it('parses suites, tests, and comments', () => {
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

  it('returns an empty list for empty output', () => {
    assert.deepStrictEqual(parseGTestListOutput(''), []);
  });
});
```

- [ ] **Step 3: 更新 `src/services/testController.ts:9`**：`import { parseGTestListOutput } from './workflowManager';` → `import { parseGTestListOutput } from './gtestParser';`

- [ ] **Step 4: 更新 `src/services/workflowManager.ts`**：删除 `494-523` 的本地 `parseGTestListOutput`，在文件头部加入 `import { parseGTestListOutput } from './gtestParser';`（供其仍存在的 `listGTestCases` 使用）

- [ ] **Step 5: 更新 `test/workflow.test.ts`**：删除 `244-258` 的 parse 用例；第 8 行改为 `import { WorkflowManager } from '../src/services/workflowManager';`（不再导入 parse 函数）

- [ ] **Step 6: 验证**

```bash
npm run compile
node -r ./test/vscode-mock.js ./node_modules/mocha/bin/mocha --timeout 10000 out/test/gtestParser.test.js out/test/testController.test.js out/test/workflow.test.js
npm test
```

预期：新解析用例 2 passing；`npm test` 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/services/gtestParser.ts test/gtestParser.test.ts src/services/testController.ts src/services/workflowManager.ts test/workflow.test.ts
git commit -m "refactor(testing): extract gtest list parser into its own module"
```

---

## Task 2：删除 WorkflowManager 的 gtest 终端执行路径

**Files:**
- Modify: `src/services/workflowManager.ts`（523 行 → 约 300 行）
- Modify: `test/workflow.test.ts`（删除 10 个 gtest 用例及无用导入）

**背景:** V0.4.0 已把 GoogleTest 迁移到 Test Explorer（`src/services/testController.ts`），WorkflowManager 中的终端执行路径只在测试中被调用，属于死代码。

- [ ] **Step 1: 从 `src/services/workflowManager.ts` 删除以下成员**

接口：`GTestRunFailure`（11-14）。
public 方法：`runGTestCase`(78-119)、`runGTestCases`(121-139)、`runAllGTestCases`(141-162)、`debugGTestCase`(164-175)、`listGTestCases`(317-329)。
private 方法：`prepareGTestDebugging`(183-212)、`runGTestCasesSequentially`(241-281)、`createGTestRunResult`(283-289)、`getUniqueGTestCases`(291-305)、`reportGTestRunFailures`(307-315)、`pickGTestCase`(331-347)。
函数：`execFileText`(480-492)。

- [ ] **Step 2: 清理导入**

- 删除 `import { execFile } from 'child_process';`
- 删除 gtestParser 导入（Task 1 加入的 `parseGTestListOutput`，此时已无使用者）
- `import { GTestCaseInfo, GTestRunResult, GTestRunSummary, PresetInfo, TargetInfo } from '../models';` → `import { PresetInfo, TargetInfo } from '../models';`
- **保留** `quoteForShell` / `quoteForPowerShell`（`createVariables` 仍在用）与 `path`、`vscode`、其他服务导入

- [ ] **Step 3: 从 `test/workflow.test.ts` 删除 gtest 用例**

删除以下 10 个 `it` 块（原行号，按当前文件内容定位）：
`runGTestCase lists cases and runs the selected filter`(260)、`runGTestCase shows a warning...`(286)、`runGTestCase stops when the user cancels...`(317)、`runGTestCases runs selected cases separately`(343)、`runGTestCases continues remaining cases after failures`(369)、`runGTestCases does not run when no cases are selected`(418)、`runAllGTestCases runs discovered cases separately`(443)、`runAllGTestCases continues after a discovered case fails`(469)、`debugGTestCase starts the selected test case directly`(505)、`listGTestCases shows an error when gtest discovery fails`(548)。
同时删除已无用的 `import type { ChildProcess } from 'child_process';` 与 `const childProcess = require('child_process') ...`（仅这些用例使用）。
**保留** `debugTarget`(575)、`debugTarget does not update launch configuration`(600)、`buildPreset continues when file api query preparation fails`(625) 等其余用例。

- [ ] **Step 4: 验证**

```bash
npm run compile
npm test
grep -rn "runGTest\|debugGTestCase\|listGTestCases" src/ || true
```

预期：`npm test` 全绿；grep 在 `src/`（.ts 文件）中无匹配。

- [ ] **Step 5: Commit**

```bash
git add src/services/workflowManager.ts test/workflow.test.ts
git commit -m "refactor(testing): remove terminal-based gtest execution paths superseded by Test Explorer"
```

---

## Task 3：删除废弃的 GTest 树视图

**Files:**
- Delete: `src/ui/gtestTreeDataProvider.ts`（296 行）
- Modify: `test/ui.test.ts`（删除导入与 402-578 的 describe 块）

**背景:** 自定义 GTests 视图已在 V0.4.0 移除，`gtestTreeDataProvider.ts` 未被任何生产代码实例化，只在 `test/ui.test.ts` 中被引用。

- [ ] **Step 1: 删除文件** `src/ui/gtestTreeDataProvider.ts`（`git rm src/ui/gtestTreeDataProvider.ts`）

- [ ] **Step 2: 更新 `test/ui.test.ts`**

- 删除第 2 行：`import { GTestCaseTreeItem, GTestTargetTreeItem, GTestTreeDataProvider } from '../src/ui/gtestTreeDataProvider';`
- 删除 `describe('GTestTreeDataProvider', ...)` 整个块（402-578，共 10 个用例），保留外层 `describe('ui', ...)` 的其余内容与结尾 `});`

- [ ] **Step 3: 验证**

```bash
npm run compile
npm test
grep -rn "gtestTreeDataProvider\|GTestTreeDataProvider" src/ test/ || true
```

预期：`npm test` 全绿；除本任务删除内容外无匹配。

- [ ] **Step 4: Commit**

```bash
git add src/ui/gtestTreeDataProvider.ts test/ui.test.ts
git commit -m "chore(ui): remove legacy gtest tree provider"
```

---

## Task 4：删除 configurationManager 未使用函数

**Files:**
- Modify: `src/services/configurationManager.ts:137-147`

- [ ] **Step 1: 删除文件末尾的 `quoteArguments` 与 `toEnvironmentArray` 两个函数**

- [ ] **Step 2: 验证**

```bash
npm run compile
npm test
grep -rn "quoteArguments\|toEnvironmentArray" src/ test/ || true
```

预期：`npm test` 全绿；无匹配。

- [ ] **Step 3: Commit**

```bash
git add src/services/configurationManager.ts
git commit -m "chore: drop unused configuration manager helpers"
```

---

## Task 5：移除仓库中过期的编译 JS（28 个文件）

**Files:**
- Delete (git rm): 28 个旧编译产物
- Modify: `.gitignore`（追加防误提交规则）

**背景:** 这些 `.js`/`.js.map` 是旧构建流程遗留、被 git 跟踪且已过期；实际运行入口全部来自 `out/`。手写脚本（`test/run-unit.js`、`test/run-coverage.js`、`test/vscode-mock.js`、`test/vscode-shim.js`、`test/shim-register.js`）必须保留。

- [ ] **Step 1: `git rm` 以下文件**

```
src/models.js src/models.js.map src/utils.js src/utils.js.map
src/services/configurationManager.js src/services/configurationManager.js.map
src/services/mappingEngine.js src/services/mappingEngine.js.map
src/services/outputLogger.js src/services/outputLogger.js.map
src/services/presetProvider.js src/services/presetProvider.js.map
src/ui/presetTreeDataProvider.js src/ui/presetTreeDataProvider.js.map
src/ui/targetTreeDataProvider.js src/ui/targetTreeDataProvider.js.map
test/helpers.js test/helpers.js.map
test/integration.test.js test/integration.test.js.map
test/models.test.js test/models.test.js.map
test/services.test.js test/services.test.js.map
test/ui.test.js test/ui.test.js.map
test/utils.test.js test/utils.test.js.map
```

- [ ] **Step 2: `.gitignore` 追加**

```
src/**/*.js
src/**/*.js.map
test/*.test.js
test/*.test.js.map
test/helpers.js
test/helpers.js.map
```

- [ ] **Step 3: 删除未跟踪的空目录** `test/mocks/`（若为空）：`rmdir test/mocks 2>/dev/null || true`

- [ ] **Step 4: 验证**

```bash
npm run compile
npm test
git status --porcelain
```

预期：`npm test` 全绿；`git status` 中仅剩本次预期的删除与 `.gitignore` 修改。

- [ ] **Step 5: Commit**

```bash
git add -A .gitignore src test
git commit -m "chore: remove stale compiled JavaScript committed alongside TypeScript sources"
```

---

## Task 6：补全测试运行列表与覆盖率

**Files:**
- Create: `test/test-files.js`（共享套件发现逻辑）
- Modify: `test/run-unit.js`
- Modify: `test/run-coverage.js`

**背景:** 当前 `run-unit.js` 只硬编码 9 个套件，漏跑 `taskExecutionEngine`、`windowsTooling`、`manifest`；`run-coverage.js` 只覆盖 2 个套件且父进程补丁无效。改为自动发现，防止以后再漏。

- [ ] **Step 1: 新建 `test/test-files.js`**

```js
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const preferredOrder = [
  'utils.test.js',
  'models.test.js',
  'services.test.js',
  'gtestSourceLocator.test.js',
  'gtestParser.test.js',
  'testController.test.js',
  'ui.test.js',
  'integration.test.js',
  'workflow.test.js',
  'taskExecutionEngine.test.js',
  'windowsTooling.test.js',
  'manifest.test.js',
  'extension.test.js',
];

function discoverTestSuites() {
  const outTestDir = path.join(projectRoot, 'out', 'test');
  const discovered = fs.readdirSync(outTestDir).filter((file) => file.endsWith('.test.js'));
  const ordered = [
    ...preferredOrder.filter((file) => discovered.includes(file)),
    ...discovered.filter((file) => !preferredOrder.includes(file)).sort(),
  ];

  return {
    testFiles: ordered.map((file) => path.join('out', 'test', file)),
    appended: ordered.filter((file) => !preferredOrder.includes(file)),
  };
}

module.exports = { discoverTestSuites };
```

- [ ] **Step 2: 重写 `test/run-unit.js`**

```js
const path = require('path');
const { spawn } = require('child_process');
const { discoverTestSuites } = require('./test-files');

const projectRoot = path.join(__dirname, '..');
const mockPath = path.join(__dirname, 'vscode-mock.js');
const { testFiles, appended } = discoverTestSuites();

if (appended.length > 0) {
  console.warn(`[run-unit] Running test suites not listed in preferredOrder: ${appended.join(', ')}`);
}

const child = spawn(process.execPath, ['-r', mockPath, 'node_modules/mocha/bin/mocha', '--timeout', '10000', ...testFiles], {
  stdio: 'inherit',
  cwd: projectRoot,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
```

- [ ] **Step 3: 重写 `test/run-coverage.js`**

```js
const path = require('path');
const { spawn } = require('child_process');
const { discoverTestSuites } = require('./test-files');

const projectRoot = path.join(__dirname, '..');
const { testFiles, appended } = discoverTestSuites();

if (appended.length > 0) {
  console.warn(`[run-coverage] Running test suites not listed in preferredOrder: ${appended.join(', ')}`);
}

const child = spawn(process.execPath, [
  'node_modules/c8/bin/c8.js',
  '--reporter=text',
  '--reporter=lcov',
  '--exclude', 'test/**',
  '--exclude', 'out/test/**',
  process.execPath,
  '-r', './test/vscode-mock.js',
  'node_modules/mocha/bin/mocha',
  '--timeout', '10000',
  ...testFiles,
], {
  stdio: 'inherit',
  cwd: projectRoot,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
```

- [ ] **Step 4: 验证**

```bash
npm test
npm run test:coverage
```

预期：`npm test` 运行 13 个套件（含 `gtestParser`、`taskExecutionEngine`、`windowsTooling`、`manifest`）全绿；覆盖率文本报告能显示 `src/services/*` 等文件的覆盖率。若 c8 与 vscode-mock 组合失败，允许回退为仅在文档说明覆盖率范围，但必须先向控制者报告。

- [ ] **Step 5: Commit**

```bash
git add test/test-files.js test/run-unit.js test/run-coverage.js
git commit -m "test: run all suites in npm test and cover the full suite in coverage report"
```

---

## Task 7：同步文档

**Files:**
- Modify: `doc/architecture.zh-CN.md`
- Modify: `TESTING.md`

- [ ] **Step 1: 更新 `doc/architecture.zh-CN.md`**

- §3.1/§3.2：补充 `GTestSourceLocator`（扫描 TEST 宏定位用例源码位置）、`DebugSessionManager`（跟踪并清理调试会话终端）、`FilterMatcher`（共享大小写不敏感/正则过滤）职责
- §4.4：更新 TestController 描述（按 `test*` 命名探测、源码位置异步 enrichment、稳定 ID）
- §6 目录树：移除 `gtestTreeDataProvider.ts`，加入 `debugSessionManager.ts`、`gtestSourceLocator.ts`、`filterMatcher.ts`、`gtestParser.ts`
- §7：更新测试相关描述（`npm test` 运行全部套件；`npm run test:coverage` 输出全量覆盖率）

- [ ] **Step 2: 更新 `TESTING.md`**

- 说明 `npm test` 会编译并运行 `out/test` 下所有 `*.test.js` 套件
- 新增 `npm run test:coverage` 说明与覆盖范围
- 删除过期的 “142 passing”，改为不写死数字或写当前实测数字
- 说明新增测试文件自动被发现（`test/test-files.js` 的 preferredOrder + 自动追加）

- [ ] **Step 3: 验证**

```bash
npm run compile
npm test
```

预期：全绿（文档改动不影响测试，仅确认无意外）。

- [ ] **Step 4: Commit**

```bash
git add doc/architecture.zh-CN.md TESTING.md
git commit -m "docs: sync architecture and testing docs with current code"
```

---

## Task 8：版本与 CHANGELOG

**Files:**
- Modify: `package.json:5`（version）
- Modify: `CHANGELOG.md`（顶部新增 V0.4.9）

- [ ] **Step 1: `package.json` version `0.4.8` → `0.4.9`**

- [ ] **Step 2: `CHANGELOG.md` 顶部（`# CMake Runner` 之后、`## V0.4.8` 之前）插入**

```markdown
## V0.4.9 2026-09-14
### Maintenance
* Remove dead code left over from the V0.4.0 GoogleTest migration, including the legacy GTest tree provider, unused terminal-based GTest execution paths, and unused helpers
* Run all test suites in `npm test` and report coverage for the full suite
* Remove stale compiled JavaScript files from the repository and synchronize the architecture and testing documentation
```

- [ ] **Step 3: 验证**：`npm test` 全绿。

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "docs(release): V0.4.9 maintenance notes"
```

---

## Task 9：最终验证

- [ ] `npm run compile && npm test && npm run test:coverage`
- [ ] `npm run package:vsix`（确认可打包；产物在 `dist/`）
- [ ] `git status` 干净；`git log --oneline -12` 逐提交复核
- [ ] 汇总：清理文件数、测试套件数、用例总数、覆盖率摘要
