# C++ CMake Runner 插件架构设计文档

## 1. 插件概述

本插件旨在为基于 CMake 的 C++ 项目提供围绕 Preset 和可执行目标的“配置 - 构建 - 运行 - 调试”体验。当前实现主要依赖 `CMakePresets.json` 和 CMake File API 元数据来展示构建预设、识别可执行目标及其源码文件，并提供基于 VS Code 原生 Tasks API 的工作流。

## 2. 核心功能特性

- **智能按需激活**：仅在包含 `CMakePresets.json` 的工作区激活。
- **预设解析与过滤**：读取 configure presets，并过滤 `hidden: true` 的条目。
- **源码到目标映射**：基于 CMake File API 返回的 target `sources` 建立 `<源码文件 -> 可执行目标>` 映射。
- **侧边栏视图联动**：通过 TreeView 展示 Preset、Target 与 GTest，并与当前编辑器联动。
- **原生任务与调试集成**：使用 VS Code Tasks API 执行 configure / build / run，并对接调试能力。
- **GoogleTest 支持**：通过 `--gtest_list_tests` 发现用例，支持按目标/用例运行与过滤。
- **可配置命令模板**：通过 `settings.json` 定制 configure、build、run 命令。

## 3. 架构分层设计

### 3.1 UI 交互层

负责处理 VS Code 侧的视图渲染与用户交互。

- **TreeView Provider**
  - `Presets` 视图：展示可用 configure preset
  - `Targets` 视图：展示可执行目标及其源码文件
  - `GTests` 视图：展示 GoogleTest 用例并按目标/用例运行
- **Command Register**
  - 注册 `cmakerunner.buildTarget`、`cmakerunner.debugTarget` 等命令
- **Editor Sync Listener**
  - 监听 `onDidChangeActiveTextEditor`，实现源码文件与 TreeView 联动

### 3.2 核心服务层

负责数据解析、状态协调与工作流编排。

- **PresetProvider**：解析 `CMakePresets.json`，处理 `inherits`、`displayName`、`binaryDir`，并为 configure preset 关联合适的 build preset / configuration
- **MappingEngine**：读取 CMake File API codemodel，提取可执行目标、推断可执行文件路径，并建立源码到目标映射
- **WorkflowManager**：串联 configure、build、run、debug 生命周期

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
6. `Targets` 视图刷新并显示可执行目标

### 4.2 源码到目标的查询链路

1. 用户打开某个 C/C++ 源文件
2. UI 层收到编辑器切换事件
3. `TargetTreeDataProvider` 根据 `MappingEngine` 的索引查找归属 target
4. 若找到匹配项，则在 `Targets` 树中自动展开并定位对应节点

### 4.3 目标构建、运行与调试链路

1. 用户在 `Targets` 视图上选择 `Build`、`Run` 或 `Debug`
2. 插件根据 target、preset、关联的 build preset / configuration 与配置模板生成实际命令
3. `TaskExecutionEngine` 以 shell task 方式执行任务；构建任务接入 `$gcc` 和 `$msCompile` problem matcher
4. `Run` 和 `Debug` 默认都会先构建目标；仅当构建成功后才继续运行或启动调试
5. `Debug` 由 `WorkflowManager` 动态构造平台默认调试配置并发起调试会话，Windows 默认为 `cppvsdbg`，Linux/macOS 默认为 `lldb`

## 5. 配置与扩展性设计

插件通过 `package.json` 的 `contributes.configuration` 暴露以下设置项：

| 设置项键名 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `cmakerunner.cmakePath` | `string` | `""` | CMake 可执行文件路径 |
| `cmakerunner.tasks.presetConfigureCommandTemplate` | `string` | `cmake --preset ${preset}` | preset configure 命令模板 |
| `cmakerunner.tasks.runCommandTemplate` | `string` | `${executableCommand}` | 运行目标命令模板 |
| `cmakerunner.tasks.clearTerminalBeforeRun` | `boolean` | `true` | 执行前是否清理终端 |
| `cmakerunner.debug.type` | `string` | `""` | Debug 配置类型 |

### 支持变量

- configure 模板：`${buildDir}`、`${preset}`、`${sourceDir}`
- build / run 模板：`${buildDir}`、`${preset}`、`${target}`、`${sourceDir}`、`${buildPreset}`、`${configuration}`、`${configurationArgument}`、`${buildPresetArgument}`、`${executablePath}`、`${quotedExecutablePath}`、`${executableCommand}`

其中：

- `${configurationArgument}` 会在存在 configuration 时展开为 ` --config <name>`
- `${buildPresetArgument}` 会在存在 build preset 时展开为 ` --preset <name>`
- `${executableCommand}` 在 Windows 下默认会生成为 `& <quoted path>`，便于直接在 PowerShell 中运行

## 6. 主要模块

```text
src/
├─ extension.ts
├─ models.ts
├─ utils.ts
├─ services/
│  ├─ configurationManager.ts
│  ├─ mappingEngine.ts
│  ├─ outputLogger.ts
│  ├─ presetProvider.ts
│  ├─ taskExecutionEngine.ts
│  ├─ windowsTooling.ts
│  └─ workflowManager.ts
└─ ui/
   ├─ gtestTreeDataProvider.ts
   ├─ presetTreeDataProvider.ts
   └─ targetTreeDataProvider.ts
```

- `extension.ts`：扩展入口、命令注册、视图与事件绑定
- `PresetProvider`：加载 preset
- `MappingEngine`：从 File API 读取可执行目标并建立源码映射
- `TaskExecutionEngine`：执行任务
- `WorkflowManager`：组织高层工作流
- `PresetTreeDataProvider` / `TargetTreeDataProvider` / `GTestTreeDataProvider`：提供树视图数据

## 7. 当前限制与后续方向

- 源码映射依赖 CMake File API 的 codemodel reply；如果项目尚未成功 configure，则不会出现目标列表
- 目前只处理第一个工作区目录，multi-root 支持有限
- 可执行文件路径推断仍有继续增强空间
- 后续可补充更多测试与自动化验证
