# CMake Runner

English documentation is the default in this file. For the Chinese version, see `doc/README.zh-CN.md`.

`CMake Runner` is a VS Code extension for CMake-based C++ projects. It puts the common workflow of **select preset -> configure -> discover targets -> build -> run/debug** into a dedicated sidebar.

It is designed for projects that already use `CMakePresets.json` and want a more direct way to work from the current source file back to the target that owns it.

Implementation and architecture notes are available in `doc/architecture.zh-CN.md`.

## What It Does

- Activates automatically when the workspace contains `CMakePresets.json`
- Lists available CMake configure presets in the `Presets` view
- Resolves preset details from `CMakePresets.json` and `CMakeUserPresets.json`, including `include` and `inherits`
- Associates configure presets with matching CMake build presets when available
- Runs preset configure directly from VS Code tasks
- Writes the CMake File API `codemodel-v2` query before configure
- Discovers supported targets (`EXECUTABLE`, `SHARED_LIBRARY`, `UTILITY`) from `<binaryDir>/.cmake/api/v1/reply/`
- Builds a source file to target mapping from the CMake codemodel
- Reveals the matching source node when the active editor switches to a mapped file
- Supports target filtering by target name, executable name, or source file name
- Builds, runs, and debugs targets from the `Targets` view or from the active mapped source file
- Registers GoogleTest cases in VS Code Test Explorer by scanning executable files under the active preset's build directory
- Supports Test Explorer run/debug actions for discovered GoogleTest cases
- Adds an editor title build button that starts from the current file and lets you pick from auto-filtered targets
- Lets you customize configure, build, and run command templates through `settings.json`

## Typical Workflow

The extension revolves around two CMake Runner activity bar views plus VS Code's built-in Test Explorer:

- `Presets`: choose the active CMake configure preset
- `Targets`: inspect discovered supported targets and their source files
- Test Explorer: inspect, run, and debug discovered GoogleTest cases

Typical usage looks like this:

1. Open a workspace that contains `CMakePresets.json`
2. Select a configure preset in `Presets`
3. Run `Build` on that preset to configure the project
4. The extension reads the CMake File API reply data from the preset's build directory
5. Discovered supported targets appear in `Targets`
6. Build, run, or debug a target from the tree
7. When you open a mapped source file, the extension reveals the corresponding source entry in the tree

## Requirements

Before using the extension, make sure the workspace meets these conditions:

1. The workspace root contains a valid `CMakePresets.json`
2. The project is a working CMake C++ project that can be configured and built
3. A supported C/C++ debugger extension is installed in VS Code, such as CodeLLDB, Native Debug, or Microsoft C/C++
4. You must successfully run configure at least once so the build directory contains CMake File API reply data

By default, preset configure runs `cmake --preset ${preset}`. The extension writes `.cmake/api/v1/query/codemodel-v2` before configure. Target discovery and source mapping rely on the CMake File API reply.

On Windows, CMake-based tasks are wrapped with `vcvarsall.bat` automatically when Visual C++ build tools can be located.

## Installation

### Install from VSIX in VS Code

1. Open the Command Palette
2. Run `Extensions: Install from VSIX...`
3. Select the generated `.vsix` file for this repository

### Install from the command line

```bash
code --install-extension cmakerunner-0.x.x.vsix
```

## Quick Start

### 1. Open a project

Open a CMake project folder that contains `CMakePresets.json`. The extension activates automatically.

### 2. Select a preset

Open the `cmakerunner` activity bar item and choose a configure preset in the **Presets** view.

### 3. Configure and discover targets

Run `Build` on the selected preset. The extension configures the project and reads metadata from:

```text
<binaryDir>/.cmake/api/v1/reply/
```

If configure succeeds and CMake generated the File API reply, supported targets (`EXECUTABLE`, `SHARED_LIBRARY`, `UTILITY`) appear in **Targets**.

### 4. Build a target

In the **Targets** view, run `Build` on a target. You can also trigger build, run, or debug from an active source file if that file maps to a discovered target.

After a successful target build, the extension offers quick `Run` and `Debug` actions.

### 5. Run or debug

You can invoke these actions directly on a target:

- `Run`
- `Debug`

By default, both actions build the target first. `Run` and `Debug` only support `EXECUTABLE` targets; non-runnable target types show a warning.

### 6. Run or debug GoogleTest cases

GoogleTest cases are registered in VS Code's built-in **Test Explorer**.
After a preset is selected and targets are refreshed, the extension scans the selected preset's `binaryDir` for executable files. Each executable candidate is probed with `--gtest_list_tests`; executables that report GoogleTest cases are added to Test Explorer.

Use Test Explorer's built-in `Run` and `Debug` actions on a test case, suite, or executable group. Run uses `--gtest_filter=<suite.case>` for each selected case. Debug starts the installed C/C++ debugger directly with the matching GoogleTest filter.

### 7. Filter targets

Use `Filter` in the **Targets** view to open a target picker that is auto-filtered from the current file when possible. You can still fall back to manual text filtering to match:

- target display name
- executable file name
- source file name
- relative source path

You can also type a regular expression and press Enter to keep every matching target visible.
Use `Clear Filter` to remove the current filter.

## Commands

The extension currently contributes these commands:

- `cmakerunner.refresh`: reload presets and rebuild the current targets view
- `cmakerunner.selectPreset`: choose the active configure preset
- `cmakerunner.buildPreset`: configure the selected preset and refresh targets
- `cmakerunner.rebuildPreset`: re-configure the selected preset and refresh targets
- `cmakerunner.buildTarget`: build the resolved target
- `cmakerunner.buildTargetFromCurrentFile`: build the target mapped to the active source file
- `cmakerunner.runTarget`: build and run the resolved target
- `cmakerunner.debugTarget`: build and debug the resolved target
- `cmakerunner.refreshGTests`: rescan the active preset build directory and refresh Test Explorer GoogleTest items
- `cmakerunner.filterTargets`: filter visible targets and source nodes
- `cmakerunner.clearTargetFilter`: clear the current target filter

## Configuration

The extension exposes these settings in VS Code `settings.json`:

| Setting | Default | Description |
| --- | --- | --- |
| `cmakerunner.cmakePath` | `""` | Optional path to `cmake` executable for preset discovery. Useful when CMake is bundled with Visual Studio but not on `PATH`. |
| `cmakerunner.tasks.presetConfigureCommandTemplate` | `cmake --preset ${preset}` | Configure command template used for preset builds |
| `cmakerunner.tasks.buildCommandTemplate` | `cmake --build ${buildDir}${configurationArgument} --target ${target}` | Build command template used for targets |
| `cmakerunner.tasks.runCommandTemplate` | `${executableCommand}` | Run command template used for targets |
| `cmakerunner.tasks.clearTerminalBeforeRun` | `true` | Clears the shared terminal before build or run tasks |

### Debugger Selection

Debug sessions are started directly through VS Code's Debug API. The extension does not write or update `launch.json` for target or GoogleTest debugging.

Debugger configuration is selected in this order:

1. Reuse the first compatible C/C++ `launch` configuration from workspace `launch.json`
2. Use CodeLLDB (`vadimcn.vscode-lldb`) when installed
3. Use Native Debug (`webfreak.debug`) when installed
4. Use Microsoft C/C++ (`ms-vscode.cpptools`) when installed

If no supported debugger extension is installed, debugging reports an error.

### Supported variables for configure templates

- `${buildDir}`
- `${preset}`
- `${sourceDir}`

### Supported variables for build and run templates

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

### Example configuration

```json
{
  "cmakerunner.cmakePath": "C:/Program Files/Microsoft Visual Studio/2022/Professional/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
  "cmakerunner.tasks.presetConfigureCommandTemplate": "cmake --preset ${preset}",
  "cmakerunner.tasks.buildCommandTemplate": "cmake --build ${buildDir}${configurationArgument} --target ${target}",
  "cmakerunner.tasks.runCommandTemplate": "${executableCommand}",
  "cmakerunner.tasks.clearTerminalBeforeRun": true
}
```

### Windows run command example

If you want to make the PowerShell invocation explicit, you can override the run command template like this:

```json
{
  "cmakerunner.tasks.runCommandTemplate": "& ${quotedExecutablePath}"
}
```

## Recommended CMake Presets Style

It is still a good idea to enable `CMAKE_EXPORT_COMPILE_COMMANDS` in your presets for compatibility with other C++ tooling. For this extension, target discovery and source mapping currently depend on the CMake File API codemodel data:

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

## Known Limitations

- Target discovery and source mapping depend on the CMake File API reply; if configure has not succeeded yet, the target list stays empty
- The extension focuses on preset configure, target discovery, build, run, and debug; it is not a full CMake project manager
- Debug sessions are created dynamically at runtime and depend on an installed supported C/C++ debugger extension
- The extension operates on the first VS Code workspace folder

## Development

### Local development

```bash
npm install
npm run compile
```

Run `F5` in VS Code to launch an Extension Development Host.

### Tests

```bash
npm test
```

### Package VSIX

```bash
npm run package:vsix
```

## Documentation

- English usage: `README.md`
- Chinese usage: `doc/README.zh-CN.md`
- Architecture notes: `doc/architecture.zh-CN.md`

## License

This project is licensed under `MIT`, as declared in `package.json`.
