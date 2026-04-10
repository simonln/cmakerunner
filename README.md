# psgmrunner

`psgmrunner` is a VS Code extension for CMake-based C++ projects. It provides a preset-aware sidebar and a native task workflow for **configure-target discovery-build-run-debug** scenarios.

This repository currently contains the extension source code and a packaged artifact:

- VSIX package: `psgmrunner-0.0.1.vsix`
- Source entry: `src/extension.ts`

---

## Features

### 1. Preset discovery
- Activates when the workspace contains `CMakePresets.json`
- Reads CMake configure presets
- Filters out presets with `hidden: true`
- Resolves `binaryDir` with basic variable replacement such as `${sourceDir}`

### 2. Source-to-target mapping
- Reads CMake File API metadata from the selected preset build directory after configure
- Reads `compile_commands.json` from the selected preset build directory
- Lists executable targets from CMake-generated metadata and builds source-to-target mappings
- Supports automatic target lookup from the active editor file

### 3. Sidebar views
- **Presets** view for available configure presets
- **Targets** view for executable targets and their source files
- Auto reveal and highlight when switching the active editor file

### 4. Native task workflow
- Build with VS Code `Task` API
- Problem matchers for GCC/MSVC compilation output
- Run target after build
- Start a C++ debug session after build success

### 5. Extension settings
The extension contributes the following settings:

- `psgmrunner.tasks.buildCommandTemplate`
- `psgmrunner.tasks.runCommandTemplate`
- `psgmrunner.tasks.clearTerminalBeforeRun`

Supported variables:

- `${buildDir}`
- `${preset}`
- `${target}`
- `${sourceDir}`

---

## Requirements

Before using the extension, make sure your workspace provides:

1. A valid `CMakePresets.json`
2. A configured preset build directory that contains `CMakeCache.txt`
3. A generated `compile_commands.json` if you want source-to-target editor mapping
4. A C++ debug environment in VS Code
   - Windows: usually `cppvsdbg`
   - Linux/macOS: usually `cppdbg`
5. A working CMake-based C++ project

`Build Preset` now runs CMake configure with `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` by default, so `compile_commands.json` is generated automatically unless you override `psgmrunner.tasks.presetConfigureCommandTemplate`.

If `compile_commands.json` is still missing, the extension can still list executable targets from CMake metadata, but source-file mapping will be empty.

---

## Install the extension manually

### Option 1: Install from VSIX in VS Code
1. Open VS Code
2. Run command: **Extensions: Install from VSIX...**
3. Select `psgmrunner-0.0.1.vsix`

### Option 2: Install from command line
```bash
code --install-extension psgmrunner-0.0.1.vsix
```

---

## How to use

### 1. Open a CMake C++ workspace
Open a folder that contains `CMakePresets.json`.

### 2. Select a preset
In the `psgmrunner` activity bar view:
- Open the **Presets** panel
- Choose one configure preset
- The extension loads the preset `binaryDir`

### 3. Load targets
After a preset is selected, the extension looks for CMake-generated metadata in the build directory, including:

```text
<binaryDir>/CMakeCache.txt
<binaryDir>/compile_commands.json
<binaryDir>/.cmake/api/v1/reply/
```

If configure metadata is available, executable targets will appear in the **Targets** panel.

### 4. Build a target
In the **Targets** view:
- Click the build action on a target
- Or trigger the build command when a mapped source file is active

### 5. Run or debug
After a successful build, the extension shows actions to:
- Run
- Debug

You can also directly invoke run/debug actions from the target item context menu.

### 6. Active editor sync
When you open a source file that exists in the mapping index, the **Targets** tree automatically reveals the corresponding target/source node.

---

## Recommended CMake setup

To improve compatibility, enable compile commands in your CMake configure flow.

Example:

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

## Extension settings example

Add settings in your workspace or user `settings.json`:

```json
{
  "psgmrunner.tasks.presetConfigureCommandTemplate": "cmake --preset ${preset} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
  "psgmrunner.tasks.buildCommandTemplate": "cmake --build ${buildDir} --config ${preset} --target ${target}",
  "psgmrunner.tasks.runCommandTemplate": "${buildDir}/${target}",
  "psgmrunner.tasks.clearTerminalBeforeRun": true
}
```

### Notes about command templates
- `${target}` is the inferred executable target name
- `${buildDir}` comes from the selected preset
- `${sourceDir}` is the workspace root
- Keep `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` in the preset configure command if you want automatic target mapping
- On Windows, you may customize the run command to append `.exe` if needed

Example:

```json
{
  "psgmrunner.tasks.runCommandTemplate": "${buildDir}/${target}.exe"
}
```

---

## Development

### 1. Install dependencies
```bash
npm install
```

### 2. Compile TypeScript
```bash
npm run compile
```

### 3. Watch mode
```bash
npm run watch
```

### 4. Run the extension in VS Code
- Open this repository in VS Code
- Press `F5`
- A new Extension Development Host window will open
- Open a CMake C++ workspace inside that window for testing

---

## Packaging

Create a VSIX package with:

```bash
npx @vscode/vsce package --allow-missing-repository
```

Generated artifact:

```text
psgmrunner-0.0.1.vsix
```

---

## Project structure

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

### Main modules
- `PresetProvider`: parse `CMakePresets.json`
- `MappingEngine`: read CMake metadata, list executable targets, and build source-to-target mappings
- `TaskExecutionEngine`: execute build and run tasks
- `WorkflowManager`: coordinate build, run, and debug lifecycle
- `PresetTreeDataProvider` / `TargetTreeDataProvider`: render sidebar views

---

## Known limitations

1. Source-file mapping still depends on `compile_commands.json`, so editor-to-target reveal is limited when compile commands are unavailable.
2. Debug launch configuration is created dynamically and assumes a valid C/C++ debugging backend is available.
3. The current workflow focuses on build/run/debug and does not manage the configure/generate phase automatically.

---

## Future improvements

Possible next steps:

- Add automatic configure/generate support
- Add better multi-root workspace support
- Add smarter executable path inference
- Add direct debug launch without confirmation dialog
- Add tests for preset parsing and mapping logic

---

## License

This repository currently has no dedicated license file. Add `LICENSE` if you plan to distribute it publicly.
