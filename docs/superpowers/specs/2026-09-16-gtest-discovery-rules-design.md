# GoogleTest 发现规则优化设计

**日期:** 2026-09-16
**目标版本:** V0.5.1
**状态:** 已批准（对话中逐项确认）

## 背景

`docs/superpowers/specs/2026-09-16-session-refactor-and-test-robustness-design.md` 将「GoogleTest 自动发现规则偏保守（仅 `test*` 命名）」列为问题 4，并推迟为独立计划。当前实现（`src/services/testController.ts` 的 `getExecutableCandidates()`）只把文件名以 `test` 开头的 `EXECUTABLE` 目标作为候选，导致 `unit_tests`、`math_test`、`MathTest` 等命名约定的测试无法出现在 Test Explorer。

本次优化只调整「候选筛选」规则，运行/调试与用例注册逻辑保持不变。

## 设计决策

### 命名模式

- 默认模式为 `test*` 前缀匹配，大小写不敏感（与旧行为一致）。
- 新增设置 `cmakerunner.gtests.executablePatterns`（`string[]`，默认 `["test*"]`）。
- 一旦用户设置了有效模式，则**完全替换**默认规则（不再隐式叠加 `test*`）。
- 模式匹配对象是去掉扩展名的可执行文件名（`path.basename(filePath, path.extname(filePath))`）。
- glob 仅支持 `*`（任意字符）与 `?`（单个字符）。
- 模式包含大写字母时区分大小写，否则不区分。这样默认 `test*` 保持大小写不敏感，而 `*Test` 不会误配 `latest`、`contest`。
- 设置值非数组、过滤空字符串后为空时，回退默认 `["test*"]`。

### 候选流程（不变的部分）

`EXECUTABLE` 目标 → `isExecutableCandidate`（平台扩展名规则）→ 文件存在 → 命名模式命中 → 去重 → `--gtest_list_tests` 探测（15s 超时，串行）→ 有用例才注册到 Test Explorer。

**明确不做：**

- 不通过源码证据（gtest include / 宏扫描）决定候选；`gtestSourceLocator` 仍只用于已发现用例的源码位置跳转。
- 不做并发探测、跨刷新探测缓存、惰性 resolve、全量探测 `EXECUTABLE`、CTest 集成。

## 兼容性约束

- 命令 ID、视图 ID、激活事件、`cmakerunner.gtests.caseTimeoutMs` 不变。
- 未设置新设置项时行为与当前一致。
- run/debug 的 `--gtest_filter=...` 路径与源码位置补全不变。

## 行为变化

- 设置 `cmakerunner.gtests.executablePatterns` 后，`test*` 默认规则不再生效（替换语义）。
- 非 `test*` 命名的测试可执行文件，只有在用户配置了对应模式后才会被探测与注册。

## 测试策略

- `test/services.test.ts`：`getGTestExecutablePatterns()` 默认值、自定义值、非法/空数组回退。
- `test/testController.test.ts`：`matchesGTestExecutableName` 的默认前缀、后缀模式、大小写、`?` 通配、无命中用例；发现级用例验证默认规则与自定义替换（按探测调用记录断言）。
- `npm test` 全量套件、`npm run test:coverage`，收尾 `npm run package:vsix`。
