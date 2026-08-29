# CMake Runner

`CMake Runner` 是一个面向基于 CMake 的 C++ 项目的 VS Code 扩展。它把常见的 **选择 preset -> configure -> 发现目标 -> 构建 -> 运行/调试** 工作流放进一个专用侧边栏中。

它适合已经使用 `CMakePresets.json` 管理构建配置，并希望从当前源码文件快速回到所属目标的人群。

实现与架构说明见 `architecture.zh-CN.md`。

## 插件功能

- 当工作区包含 `CMakePresets.json` 时自动激活
- 在 `Presets` 视图中列出可用的 CMake configure preset
- 从 `CMakePresets.json` 和 `CMakeUserPresets.json` 解析 preset，支持 `include` 与 `inherits`
- 在存在对应关系时，自动将 configure preset 与 CMake build preset 关联起来
- 通过 VS Code Task 直接执行 preset configure
- 在 configure 前自动写入 CMake File API 的 `codemodel-v2` 查询文件
- 从 `<binaryDir>/.cmake/api/v1/reply/` 发现受支持目标（`EXECUTABLE`、`SHARED_LIBRARY`、`UTILITY`）
- 基于 CMake codemodel 建立“源文件 -> 目标”的映射关系
- 当活动编辑器切换到已映射源码时，在树中定位对应源码节点
- 支持按目标名、可执行文件名、源码文件名过滤目标
- 可从 `Targets` 视图或当前已映射源码文件直接执行 build、run、debug
- 扫描当前 preset 构建目录下的可执行文件，并把发现的 GoogleTest 用例注册到 VS Code 内置测试资源管理器
- 支持测试资源管理器中的 GoogleTest run/debug 操作
- 支持通过 `settings.json` 自定义 configure、build、run 命令模板

## 典型工作流

插件围绕两个 CMake Runner 活动栏视图和 VS Code 内置测试资源管理器工作：

- `Presets`：选择当前使用的 CMake configure preset
- `Targets`：查看当前发现的受支持目标及其源码文件
- 测试资源管理器：查看、运行和调试已发现的 GoogleTest 用例

典型流程如下：

1. 打开包含 `CMakePresets.json` 的工作区
2. 在 `Presets` 中选择一个 configure preset
3. 对该 preset 执行 `Build`，先完成 configure
4. 插件从对应构建目录读取 CMake File API reply 数据
5. 已发现的受支持目标显示在 `Targets` 中
6. 在树上对目标执行 build、run 或 debug
7. 打开某个已映射源码文件时，插件会在树中定位对应源码节点

## 使用前提

使用前请确认工作区满足以下条件：

1. 工作区根目录包含有效的 `CMakePresets.json`
2. 项目本身是可正常 configure 和 build 的 CMake C++ 工程
3. VS Code 中已经安装受支持的 C/C++ 调试扩展，例如 CodeLLDB、Native Debug 或 Microsoft C/C++
4. 至少需要先成功执行一次 configure，让构建目录中生成 CMake File API reply 数据

默认情况下，preset configure 使用 `cmake --preset ${preset}`，并且会在 configure 前写入 `.cmake/api/v1/query/codemodel-v2`。当前目标发现与源码映射主要依赖 CMake File API reply。

在 Windows 上，如果系统中可定位 Visual C++ 工具链，基于 `cmake` 的任务会自动通过 `vcvarsall.bat` 包装执行。

## 安装方式

### 通过 VSIX 在 VS Code 中安装

1. 打开命令面板
2. 执行 `Extensions: Install from VSIX...`
3. 选择本仓库生成的 `.vsix` 文件

### 通过命令行安装

```bash
code --install-extension cmakerunner-0.x.x.vsix
```

## 快速上手

### 1. 打开项目

打开包含 `CMakePresets.json` 的 CMake 项目目录，插件会自动激活。

### 2. 选择 Preset

打开活动栏中的 `cmakerunner`，然后在 **Presets** 视图中选择一个 configure preset。

### 3. 配置并发现目标

对选中的 preset 执行 `Build`。插件会先执行 configure，然后从以下位置读取元数据：

```text
<binaryDir>/.cmake/api/v1/reply/
```

如果 configure 成功，且 CMake 已生成 File API reply，**Targets** 视图中就会显示该 preset 下识别到的受支持目标（`EXECUTABLE`、`SHARED_LIBRARY`、`UTILITY`）。

### 4. 构建目标

在 **Targets** 视图中对目标执行 `Build`。如果当前活动源码文件已经映射到某个目标，也可以直接触发 build、run、debug。

目标构建成功后，插件会额外提供快速 `Run` 和 `Debug` 操作。

### 5. 运行或调试

你可以直接对目标执行以下操作：

- `Run`
- `Debug`

默认情况下，这两个操作都会先构建目标。`Run` 和 `Debug` 仅支持 `EXECUTABLE` 目标；对不可运行的目标类型会提示 warning。

### 6. 运行或调试 GoogleTest 用例

GoogleTest 用例会注册到 VS Code 内置的 **测试资源管理器**。
选择 preset 并刷新目标后，插件会扫描当前 preset 的 `binaryDir` 下的可执行文件。每个候选可执行文件都会用 `--gtest_list_tests` 探测；能返回 GoogleTest 用例的可执行文件会被加入测试资源管理器。

你可以在测试资源管理器中对单个用例、suite 或可执行文件分组使用内置 `Run` 和 `Debug`。Run 会对每个选中的用例使用 `--gtest_filter=<suite.case>`；Debug 会带着对应 GoogleTest filter 直接启动已安装的 C/C++ 调试器。

### 7. 过滤目标

你可以在 **Targets** 视图中使用 `Filter` 匹配：

- 目标显示名
- 可执行文件名
- 源码文件名
- 相对源码路径

你也可以直接输入正则表达式并回车，保留所有匹配的目标。
使用 `Clear Filter` 可清除当前过滤条件。

## 命令列表

当前扩展提供以下命令：

- `cmakerunner.refresh`：重新加载 preset，并刷新当前 targets 视图
- `cmakerunner.selectPreset`：选择当前 configure preset
- `cmakerunner.buildPreset`：对选中的 preset 执行 configure 并刷新目标
- `cmakerunner.rebuildPreset`：对选中的 preset 重新执行 configure 并刷新目标
- `cmakerunner.buildTarget`：构建解析到的目标
- `cmakerunner.buildTargetFromCurrentFile`：构建当前活动源文件映射到的目标
- `cmakerunner.runTarget`：构建并运行解析到的目标
- `cmakerunner.debugTarget`：构建并调试解析到的目标
- `cmakerunner.refreshGTests`：重新扫描当前 preset 构建目录并刷新测试资源管理器中的 GoogleTest 条目
- `cmakerunner.filterTargets`：过滤可见目标和源码节点
- `cmakerunner.clearTargetFilter`：清除当前目标过滤条件

## 配置说明

插件通过 VS Code `settings.json` 暴露以下配置项：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `cmakerunner.cmakePath` | `""` | 可选的 `cmake` 可执行文件路径，适用于 CMake 随 Visual Studio 安装但未加入 `PATH` 的情况 |
| `cmakerunner.tasks.presetConfigureCommandTemplate` | `cmake --preset ${preset}` | preset configure 使用的命令模板 |
| `cmakerunner.tasks.buildCommandTemplate` | `cmake --build ${buildDir} ${configurationArgument} --target ${target}` | 目标构建使用的命令模板 |
| `cmakerunner.tasks.runCommandTemplate` | `${executableCommand}` | 目标运行使用的命令模板 |
| `cmakerunner.tasks.clearTerminalBeforeRun` | `true` | build 或 run 前是否清理共享终端 |

### 调试器选择

调试会话通过 VS Code Debug API 直接启动。扩展不会为目标调试或 GoogleTest 调试写入或更新 `launch.json`。

调试配置按以下顺序选择：

1. 优先复用工作区 `launch.json` 中第一个兼容的 C/C++ `launch` 配置
2. 如果安装了 CodeLLDB (`vadimcn.vscode-lldb`)，使用 CodeLLDB
3. 如果安装了 Native Debug (`webfreak.debug`)，使用 Native Debug
4. 如果安装了 Microsoft C/C++ (`ms-vscode.cpptools`)，使用 Microsoft C/C++

如果没有安装受支持的调试扩展，调试时会显示错误。

### configure 模板支持的变量

- `${buildDir}`
- `${preset}`
- `${sourceDir}`

### build / run 模板支持的变量

- `${buildDir}`
- `${preset}`
- `${target}`
- `${sourceDir}`
- `${buildPreset}`
- `${configuration}`
- `${configurationArgument}`
- `${buildPresetArgument}`
- `${executablePath}`
- `${quotedExecutablePath}`
- `${executableCommand}`

替换后的值若包含空格会自动加双引号（例如构建目录含空格时 `cmake --build ${buildDir}` 会变成 `cmake --build "C:/My Projects/build"`），路径或名称带空格不会导致命令拼接出错。`${configurationArgument}`、`${executableCommand}` 这类预拼片段自带格式，不会被重复加引号。

### 配置示例

```json
{
  "cmakerunner.tasks.presetConfigureCommandTemplate": "cmake --preset ${preset}",
  "cmakerunner.tasks.buildCommandTemplate": "cmake --build ${buildDir} ${configurationArgument} --target ${target}",
  "cmakerunner.tasks.runCommandTemplate": "${executableCommand}",
  "cmakerunner.tasks.clearTerminalBeforeRun": true
}
```

在 Windows 上，`${executableCommand}` 会展开为 `& "path"`（PowerShell 调用运算符），运行模板无需额外加引号。

## 推荐的 CMake Presets 写法

虽然当前扩展的目标发现和源码映射主要依赖 CMake File API codemodel 数据，但仍然建议在 preset 中启用 `CMAKE_EXPORT_COMPILE_COMMANDS`，以便和其他 C++ 工具链保持兼容：

```json
{
  "version": 3,
  "configurePresets": [
    {
      "name": "debug",
      "binaryDir": "${sourceDir}/build/debug",
      "cacheVariables": {
        "CMAKE_EXPORT_COMPILE_COMMANDS": true
      }
    }
  ]
}
```

## 已知限制

- 目标发现和源码映射依赖 CMake File API reply；如果 configure 尚未成功完成，目标列表会为空
- 当前扩展聚焦于 preset configure、target discovery、build、run、debug，并不是完整的 CMake 项目管理器
- 调试会话在运行时动态创建，依赖已安装的受支持 C/C++ 调试扩展
- 当前扩展只使用 VS Code 工作区中的第一个文件夹

## 开发

### 本地开发

```bash
npm install
npm run compile
```

在 VS Code 中按 `F5` 可启动 Extension Development Host。

### 测试

```bash
npm test
```

### 打包 VSIX

```bash
npm run package:vsix
```

## 文档

- 英文说明：`README.md`
- 中文说明：`doc/README.zh-CN.md`
- 架构说明：`doc/architecture.zh-CN.md`

## License

项目使用 `MIT` 许可证，以 `package.json` 中的声明为准。
