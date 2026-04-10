# psgmrunner

`psgmrunner` 是一个面向基于 CMake 的 C++ 项目的 VS Code 扩展。它提供了一个感知 Preset 的侧边栏，以及围绕 **configure-target discovery-build-run-debug** 场景的原生任务工作流。

当前仓库包含扩展源码和一个已打包产物：

- VSIX 安装包：`psgmrunner-0.0.1.vsix`
- 源码入口：`src/extension.ts`

---

## 功能特性

### 1. Preset 发现
- 当工作区包含 `CMakePresets.json` 时自动激活
- 读取 CMake configure presets
- 过滤 `hidden: true` 的 preset
- 支持对 `binaryDir` 做基础变量替换，例如 `${sourceDir}`

### 2. 源文件到目标的映射
- 在 configure 完成后，从所选 preset 的构建目录读取 CMake File API 元数据
- 从所选 preset 的构建目录读取 `compile_commands.json`
- 列出 CMake 生成元数据中的可执行目标，并在内存中建立源文件与目标之间的映射关系
- 支持根据当前激活编辑器中的文件自动查找对应目标

### 3. 侧边栏视图
- **Presets** 视图用于展示可用的 configure presets
- **Targets** 视图用于展示可执行目标及其源文件
- 切换当前编辑器文件时自动定位并高亮对应节点

### 4. 原生任务工作流
- 使用 VS Code `Task` API 进行构建
- 为 GCC/MSVC 编译输出提供 problem matcher
- 构建完成后可直接运行目标
- 构建成功后可启动 C++ 调试会话

### 5. 扩展设置项
扩展提供以下配置项：

- `psgmrunner.tasks.buildCommandTemplate`
- `psgmrunner.tasks.runCommandTemplate`
- `psgmrunner.tasks.clearTerminalBeforeRun`

支持的变量：

- `${buildDir}`
- `${preset}`
- `${target}`
- `${sourceDir}`

---

## 使用要求

在使用扩展前，请确保你的工作区具备以下条件：

1. 有效的 `CMakePresets.json`
2. 已完成 configure 的 preset 构建目录，并且其中包含 `CMakeCache.txt`
3. 如果你希望获得源文件到目标的编辑器映射，还需要生成 `compile_commands.json`
4. VS Code 中已具备可用的 C++ 调试环境
   - Windows：通常为 `cppvsdbg`
   - Linux/macOS：通常为 `cppdbg`
5. 一个可正常工作的、基于 CMake 的 C++ 项目

现在 `Build Preset` 默认会用 `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` 执行 CMake configure，因此除非你覆盖了 `psgmrunner.tasks.presetConfigureCommandTemplate`，否则会自动生成 `compile_commands.json`。

如果 `compile_commands.json` 仍然缺失，扩展仍然可以根据 CMake 元数据列出可执行目标，但源文件映射会为空。

---

## 手动安装扩展

### 方式 1：在 VS Code 中通过 VSIX 安装
1. 打开 VS Code
2. 执行命令：**Extensions: Install from VSIX...**
3. 选择 `psgmrunner-0.0.1.vsix`

### 方式 2：通过命令行安装
```bash
code --install-extension psgmrunner-0.0.1.vsix
```

---

## 使用方法

### 1. 打开一个 CMake C++ 工作区
打开包含 `CMakePresets.json` 的文件夹。

### 2. 选择 preset
在 `psgmrunner` 的活动栏视图中：
- 打开 **Presets** 面板
- 选择一个 configure preset
- 扩展会加载该 preset 的 `binaryDir`

### 3. 加载目标
选中 preset 后，扩展会在构建目录中查找 CMake 生成的元数据，包括：

```text
<binaryDir>/CMakeCache.txt
<binaryDir>/compile_commands.json
<binaryDir>/.cmake/api/v1/reply/
```

如果 configure 元数据可用，对应的可执行目标就会显示在 **Targets** 面板中。

### 4. 构建目标
在 **Targets** 视图中：
- 点击目标上的构建操作
- 或在当前激活文件已建立映射时触发构建命令

### 5. 运行或调试
构建成功后，扩展会提供以下操作：
- 运行
- 调试

你也可以直接从目标项的右键菜单中触发运行或调试。

### 6. 当前编辑器同步
当你打开一个已存在于映射索引中的源文件时，**Targets** 树会自动定位到对应的目标/源文件节点。

---

## 推荐的 CMake 配置

为了提高兼容性，建议在 CMake 配置流程中启用 compile commands。

示例：

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

---

## 扩展设置示例

在工作区或用户级 `settings.json` 中加入如下配置：

```json
{
  "psgmrunner.tasks.presetConfigureCommandTemplate": "cmake --preset ${preset} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
  "psgmrunner.tasks.buildCommandTemplate": "cmake --build ${buildDir} --config ${preset} --target ${target}",
  "psgmrunner.tasks.runCommandTemplate": "${buildDir}/${target}",
  "psgmrunner.tasks.clearTerminalBeforeRun": true
}
```

### 关于命令模板的说明
- `${target}` 为推断得到的可执行目标名
- `${buildDir}` 来自当前选中的 preset
- `${sourceDir}` 为工作区根目录
- 如果你希望自动生成目标映射，请在 preset configure 命令中保留 `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`
- 在 Windows 上，如果有需要，可以自定义运行命令并追加 `.exe`

示例：

```json
{
  "psgmrunner.tasks.runCommandTemplate": "${buildDir}/${target}.exe"
}
```

---

## 开发

### 1. 安装依赖
```bash
npm install
```

### 2. 编译 TypeScript
```bash
npm run compile
```

### 3. 监听模式
```bash
npm run watch
```

### 4. 在 VS Code 中运行扩展
- 用 VS Code 打开本仓库
- 按下 `F5`
- 会打开一个新的 Extension Development Host 窗口
- 在该窗口中打开一个 CMake C++ 工作区进行测试

---

## 打包

使用以下命令生成 VSIX 包：

```bash
npx @vscode/vsce package --allow-missing-repository
```

生成产物：

```text
psgmrunner-0.0.1.vsix
```

---

## 项目结构

```text
.
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ extension.ts
│  ├─ models.ts
│  ├─ utils.ts
│  ├─ services/
│  │  ├─ configurationManager.ts
│  │  ├─ mappingEngine.ts
│  │  ├─ presetProvider.ts
│  │  ├─ taskExecutionEngine.ts
│  │  └─ workflowManager.ts
│  └─ ui/
│     ├─ presetTreeDataProvider.ts
│     └─ targetTreeDataProvider.ts
└─ resources/
   └─ cmake-runner.svg
```

### 主要模块
- `PresetProvider`：解析 `CMakePresets.json`
- `MappingEngine`：读取 CMake 元数据，列出可执行目标，并构建源文件到目标的映射
- `TaskExecutionEngine`：执行构建和运行任务
- `WorkflowManager`：协调构建、运行和调试生命周期
- `PresetTreeDataProvider` / `TargetTreeDataProvider`：渲染侧边栏视图

---

## 已知限制

1. 源文件映射仍依赖 `compile_commands.json`，因此在缺少 compile commands 时，编辑器到目标的自动定位能力会受限。
2. 调试启动配置是动态创建的，默认假设系统中已存在可用的 C/C++ 调试后端。
3. 当前工作流主要聚焦于 build/run/debug，尚未自动管理 configure/generate 阶段。

---

## 后续改进方向

可能的下一步包括：

- 增加自动 configure/generate 支持
- 增强 multi-root workspace 支持
- 提供更智能的可执行文件路径推断
- 支持无需确认对话框的直接调试启动
- 为 preset 解析和映射逻辑补充测试

---

## License

当前仓库尚未提供独立的许可证文件。如果计划公开分发，建议补充 `LICENSE`。
