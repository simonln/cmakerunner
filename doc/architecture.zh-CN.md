# C++ CMake Runner 插件架构设计文档

## 1. 插件概述

本插件旨在为基于 CMake 的 C++ 项目提供围绕 Preset 和目标的“配置 - 构建 - 运行 - 调试”体验。当前实现主要依赖 `CMakePresets.json` 和 CMake File API 元数据来展示构建预设、识别受支持目标（`EXECUTABLE`、`SHARED_LIBRARY`、`UTILITY`）及其源码文件，并提供基于 VS Code 原生 Tasks API、Testing API 与 Debug API 的工作流。

## 2. 核心功能特性

- **智能按需激活**：在包含 `CMakePresets.json` 或 `CMakeUserPresets.json` 的工作区激活；VS Code 启动完成后也会完成激活（`onStartupFinished`），让测试资源管理器集成提前可用。
- **预设解析与过滤**：读取 configure presets，并过滤 `hidden: true` 的条目。
- **源码到目标映射**：基于 CMake File API 返回的 target `sources` 建立 `<源码文件 -> 目标>` 映射。
- **侧边栏视图联动**：通过 TreeView 展示 Preset 与 Target，并与当前编辑器联动。
- **原生任务与调试集成**：使用 VS Code Tasks API 执行 configure / build / run，并对接调试能力。
- **GoogleTest 支持**：从已发现的可执行目标中筛选可执行文件名以 `test` 开头（大小写不敏感）的目标，通过 `--gtest_list_tests` 探测用例，并注册到 VS Code 测试资源管理器。
- **可配置命令模板**：通过 `settings.json` 定制 configure、build、run 命令。

## 3. 架构分层设计

### 3.1 UI 交互层

负责处理 VS Code 侧的视图渲染与用户交互。

- **TreeView Provider**
  - `Presets` 视图：展示可用 configure preset
  - `Targets` 视图：展示受支持目标及其源码文件
- **TestController**
  - 使用 VS Code Testing API 注册 GoogleTest 可执行文件、suite 和 case
  - 响应测试资源管理器中的 run / debug 请求
- **FilterMatcher**（`src/ui/filterMatcher.ts`）
  - `createFilterMatcher` 为 Targets 树提供大小写不敏感的子串/正则匹配
  - `getRegexFilterError` 供 `src/extension.ts` 的过滤 QuickPick 校验用户输入的正则是否合法
- **Command Register**
  - 注册 `cmakerunner.buildTarget`、`cmakerunner.debugTarget` 等命令
- **Editor Sync Listener**
  - 监听 `onDidChangeActiveTextEditor`，实现源码文件与 TreeView 联动

### 3.2 核心服务层

负责数据解析、状态协调与工作流编排。

- **PresetProvider**：解析 `CMakePresets.json`，处理 `inherits`、`displayName`、`binaryDir`，并为 configure preset 关联合适的 build preset / configuration
- **MappingEngine**：读取 CMake File API codemodel，提取受支持目标、推断构建产物路径，并建立源码到目标映射
- **WorkflowManager**：串联 configure、build、run、debug 生命周期
- **GTestTestController**：从当前目标列表筛选可执行文件名以 `test` 开头的目标，发现 GoogleTest 用例并处理 Test Explorer run/debug profile
- **GTestSourceLocator**（`src/services/gtestSourceLocator.ts`）：扫描目标源码中的 `TEST/TEST_F/TEST_P/TYPED_TEST(_P)` 宏，把已发现的 GoogleTest 用例映射到文件/行列
- **DebugSessionManager**（`src/services/debugSessionManager.ts`）：跟踪通过 `startDebugging` 启动的调试会话及其打开的终端，在会话结束后清理

### 3.3 执行与集成层

- **TaskExecutionEngine**：构造并执行 `vscode.Task`，接入 problem matcher
- **ConfigurationManager**：读取用户设置并完成模板变量替换
- **OutputLogger**：输出扩展运行日志，便于定位问题

## 4. 核心工作流与数据流

### 4.1 Preset 选择到目标发现

1. 用户在 `Presets` 视图选择一个 preset
2. 插件记录选中项并刷新视图状态
3. 用户执行 `Build Preset`
4. `WorkflowManager` 调用 `TaskExecutionEngine` 运行 configure 命令
5. configure 成功后，`WorkflowManager` 会先写入 `.cmake/api/v1/query/codemodel-v2` 请求文件，随后 `MappingEngine` 读取构建目录中的 File API reply 数据
6. `Targets` 视图刷新并显示受支持目标

### 4.2 源码到目标的查询链路

1. 用户打开某个 C/C++ 源文件
2. UI 层收到编辑器切换事件
3. `TargetTreeDataProvider` 根据 `MappingEngine` 的索引查找归属 target
4. 若找到匹配项，则在 `Targets` 树中自动展开并定位对应节点

### 4.3 目标构建、运行与调试链路

1. 用户在 `Targets` 视图上选择 `Build`、`Run` 或 `Debug`
2. 插件根据 target、preset、关联的 build preset / configuration 与配置模板生成实际命令
3. `TaskExecutionEngine` 以 shell task 方式执行任务；构建任务接入 `$gcc` 和 `$msCompile` problem matcher
4. `Run` 和 `Debug` 默认都会先构建目标；仅当构建成功后才继续运行或启动调试，且仅 `EXECUTABLE` 目标可运行/调试
5. `Debug` 由 `WorkflowManager` 动态构造调试配置并通过 VS Code Debug API 直接发起调试会话，不写入 `launch.json`
6. 调试配置优先复用 `launch.json` 中兼容的 C/C++ launch 配置，否则按已安装扩展选择 CodeLLDB、Native Debug 或 Microsoft C/C++

### 4.4 GoogleTest 发现与运行链路

1. 当前 preset 变化或目标刷新后，`GTestTestController` 基于当前目标列表挑选候选可执行文件
2. 按 `cmakerunner.gtests.executablePatterns`（默认 `test*`，大小写不敏感；配置后替换默认）筛选可执行目标，并确认文件真实存在
3. 每个候选可执行文件通过 `--gtest_list_tests` 探测是否包含 GoogleTest 用例，由 `GTestParser` 解析输出
4. 发现到的用例按“可执行文件 -> suite -> case”注册到 VS Code 测试资源管理器
5. 注册完成后异步通过 `GTestSourceLocator` 扫描目标源码位置，为用例补充文件与行列信息，用于 Test Explorer 定位
6. 运行/调试会先检查测试树是否已注册，避免重复执行冗余的全量发现扫描
7. Run 对每个选中用例使用 `--gtest_filter=<suite.case>` 运行
8. Debug 按可执行文件聚合选中用例、合并过滤表达式后直接启动已安装调试器；调试会话及其打开的终端由 `DebugSessionManager` 跟踪，并在会话结束后清理

## 5. 配置与扩展性设计

插件通过 `package.json` 的 `contributes.configuration` 暴露以下设置项：

| 设置项键名 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `cmakerunner.cmakePath` | `string` | `""` | CMake 可执行文件路径 |
| `cmakerunner.tasks.presetConfigureCommandTemplate` | `string` | `cmake --preset ${preset}` | preset configure 命令模板 |
| `cmakerunner.tasks.buildCommandTemplate` | `string` | `cmake --build ${buildDir} ${configurationArgument} --target ${target}` | 目标构建命令模板 |
| `cmakerunner.tasks.runCommandTemplate` | `string` | `${executableCommand}` | 运行目标命令模板 |
| `cmakerunner.gtests.executablePatterns` | `string[]` | `["test*"]` | GoogleTest 候选可执行文件名的 glob 模式；配置后替换默认规则 |

### 支持变量

- configure 模板：`${buildDir}`、`${preset}`、`${sourceDir}`
- build / run 模板：`${buildDir}`、`${preset}`、`${target}`、`${sourceDir}`、`${buildPreset}`、`${configuration}`、`${configurationArgument}`、`${buildPresetArgument}`、`${executablePath}`、`${quotedExecutablePath}`、`${executableCommand}`

其中：

- `${configurationArgument}` 会在存在 configuration 时展开为 ` --config <name>`
- `${buildPresetArgument}` 会在存在 build preset 时展开为 ` --preset <name>`
- `${executableCommand}` 在 Windows 下默认会生成为 `& <quoted path>`，便于直接在 PowerShell 中运行
- 命令模板中替换后的值若包含空格会自动加双引号，避免路径或名称带空格导致命令拼接错误；预拼片段（如 `${configurationArgument}`、`${executableCommand}`）不会重复加引号

## 6. 主要模块

```text
src/
├─ extension.ts
├─ models.ts
├─ utils.ts
├─ services/
│  ├─ configurationManager.ts
│  ├─ debugSessionManager.ts
│  ├─ gtestParser.ts
│  ├─ gtestSourceLocator.ts
│  ├─ mappingEngine.ts
│  ├─ outputLogger.ts
│  ├─ presetProvider.ts
│  ├─ taskExecutionEngine.ts
│  ├─ testController.ts
│  ├─ windowsTooling.ts
│  └─ workflowManager.ts
└─ ui/
   ├─ filterMatcher.ts
   ├─ presetTreeDataProvider.ts
   └─ targetTreeDataProvider.ts
```

- `extension.ts`：扩展入口、命令注册、视图与事件绑定
- `PresetProvider`：加载 preset
- `MappingEngine`：从 File API 读取受支持目标并建立源码映射
- `TaskExecutionEngine`：执行任务
- `WorkflowManager`：组织高层工作流
- `GTestTestController`：提供 VS Code Test Explorer 中的 GoogleTest 发现、运行与调试集成
- `GTestParser`：解析 `--gtest_list_tests` 输出为 suite/case 列表
- `GTestSourceLocator`：把已发现的 GoogleTest 用例映射到源码文件与行列
- `DebugSessionManager`：跟踪并清理目标与测试的调试会话及其终端
- `FilterMatcher`：Targets 树与过滤 QuickPick 共享的大小写不敏感子串/正则匹配（`createFilterMatcher` / `getRegexFilterError`）
- `PresetTreeDataProvider` / `TargetTreeDataProvider`：提供树视图数据

## 7. 当前限制与后续方向

- 源码映射依赖 CMake File API 的 codemodel reply；如果项目尚未成功 configure，则不会出现目标列表
- 目前只处理第一个工作区目录，multi-root 支持有限
- 可执行文件路径推断仍有继续增强空间
- 测试：`npm test` 会运行全部测试套件（2026-09-14 实测：13 个套件、149 个用例），`npm run test:coverage` 可输出全量覆盖率报告
