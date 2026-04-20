# psgmrunner

English documentation is the default in this file. For the Chinese version, see `doc/README.zh-CN.md`.

`psgmrunner` is a VS Code extension for CMake-based C++ projects. It puts the common workflow of **select preset -> configure -> discover executable targets -> build -> run/debug** into a dedicated sidebar.

It is designed for projects that already use `CMakePresets.json` and want a more direct way to work from the current source file back to the executable target that owns it.

Implementation and architecture notes are available in `doc/architecture.zh-CN.md`.

## What It Does

- Activates automatically when the workspace contains `CMakePresets.json`
- Lists available CMake configure presets in the `Presets` view
- Resolves preset details from `CMakePresets.json` and `CMakeUserPresets.json`, including `include` and `inherits`
- Associates configure presets with matching CMake build presets when available
- Runs preset configure directly from VS Code tasks
- Writes the CMake File API `codemodel-v2` query before configure
- Discovers executable targets from `<binaryDir>/.cmake/api/v1/reply/`
- Builds a source file to executable target mapping from the CMake codemodel
- Reveals the matching source node when the active editor switches to a mapped file
- Supports target filtering by target name, executable name, or source file name
- Builds, runs, and debugs targets from the `Targets` view or from the active mapped source file
- Lets you customize configure, build, and run command templates through `settings.json`

## Typical Workflow

The extension revolves around two activity bar views:

- `Presets`: choose the active CMake configure preset
- `Targets`: inspect discovered executable targets and their source files

Typical usage looks like this:

1. Open a workspace that contains `CMakePresets.json`
2. Select a configure preset in `Presets`
3. Run `Build` on that preset to configure the project
4. The extension reads the CMake File API reply data from the preset's build directory
5. Discovered executable targets appear in `Targets`
6. Build, run, or debug a target from the tree
7. When you open a mapped source file, the extension reveals the corresponding source entry in the tree

## Requirements

Before using the extension, make sure the workspace meets these conditions:

1. The workspace root contains a valid `CMakePresets.json`
2. The project is a working CMake C++ project that can be configured and built
3. A C/C++ debugging backend is available in VS Code
   - Windows: usually `cppvsdbg`
   - Linux/macOS: usually `cppdbg`
4. You must successfully run configure at least once so the build directory contains CMake File API reply data

By default, preset configure runs `cmake --preset ${preset} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` and also writes `.cmake/api/v1/query/codemodel-v2` before configure. Target discovery and source mapping currently rely on the CMake File API reply.

On Windows, CMake-based tasks are wrapped with `vcvarsall.bat` automatically when Visual C++ build tools can be located.

## Installation

### Install from VSIX in VS Code

1. Open the Command Palette
2. Run `Extensions: Install from VSIX...`
3. Select the generated `.vsix` file for this repository

### Install from the command line

```bash
code --install-extension psgmrunner-0.0.4.vsix
```

## Quick Start

### 1. Open a project

Open a CMake project folder that contains `CMakePresets.json`. The extension activates automatically.

### 2. Select a preset

Open the `psgmrunner` activity bar item and choose a configure preset in the **Presets** view.

### 3. Configure and discover targets

Run `Build` on the selected preset. The extension configures the project and reads metadata from:

```text
<binaryDir>/.cmake/api/v1/reply/
```

If configure succeeds and CMake generated the File API reply, executable targets appear in **Targets**.

### 4. Build a target

In the **Targets** view, run `Build` on a target. You can also trigger build, run, or debug from an active source file if that file maps to a discovered target.

After a successful target build, the extension offers quick `Run` and `Debug` actions.

### 5. Run or debug

You can invoke these actions directly on a target:

- `Run`
- `Debug`

By default, both actions build the target first.

### 6. Filter targets

Use `Filter` in the **Targets** view to match:

- target display name
- executable file name
- source file name
- relative source path

Use `Clear Filter` to remove the current filter.

## Commands

The extension currently contributes these commands:

- `psgmrunner.refresh`: reload presets and rebuild the current targets view
- `psgmrunner.selectPreset`: choose the active configure preset
- `psgmrunner.buildPreset`: configure the selected preset and refresh targets
- `psgmrunner.buildTarget`: build the resolved target
- `psgmrunner.runTarget`: build and run the resolved target
- `psgmrunner.debugTarget`: build and debug the resolved target
- `psgmrunner.filterTargets`: filter visible targets and source nodes
- `psgmrunner.clearTargetFilter`: clear the current target filter

## Configuration

The extension exposes these settings in VS Code `settings.json`:

| Setting | Default | Description |
| --- | --- | --- |
| `psgmrunner.cmakePath` | `""` | Optional path to `cmake` executable for preset discovery. Useful when CMake is bundled with Visual Studio but not on `PATH`. |
| `psgmrunner.tasks.presetConfigureCommandTemplate` | `cmake --preset ${preset} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` | Configure command template used for preset builds |
| `psgmrunner.tasks.buildCommandTemplate` | `cmake --build ${buildDir}${configurationArgument} --target ${target}` | Build command template used for targets |
| `psgmrunner.tasks.runCommandTemplate` | `${executableCommand}` | Run command template used for targets |
| `psgmrunner.tasks.clearTerminalBeforeRun` | `true` | Clears the shared terminal before build or run tasks |

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
  "psgmrunner.cmakePath": "C:/Program Files/Microsoft Visual Studio/2022/Professional/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
  "psgmrunner.tasks.presetConfigureCommandTemplate": "cmake --preset ${preset} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
  "psgmrunner.tasks.buildCommandTemplate": "cmake --build ${buildDir}${configurationArgument} --target ${target}",
  "psgmrunner.tasks.runCommandTemplate": "${executableCommand}",
  "psgmrunner.tasks.clearTerminalBeforeRun": true
}
```

### Windows run command example

If you want to make the PowerShell invocation explicit, you can override the run command template like this:

```json
{
  "psgmrunner.tasks.runCommandTemplate": "& ${quotedExecutablePath}"
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
- Debug configurations are created dynamically at runtime and depend on an available C/C++ debug backend
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
npx @vscode/vsce package --allow-missing-repository
```

## Documentation

- English usage: `README.md`
- Chinese usage: `doc/README.zh-CN.md`
- Architecture notes: `doc/architecture.zh-CN.md`

## License

This project is licensed under `MIT`, as declared in `package.json`.
