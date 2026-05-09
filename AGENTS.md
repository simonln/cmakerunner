# AGENTS.md

## Developer Commands

```bash
npm install            # Install dependencies
npm run compile        # Compile TypeScript to out/
npm run watch         # Watch mode for development
npx @vscode/vsce package --allow-missing-repository   # Build VSIX
```

- Press **F5** in VS Code to debug the extension in Extension Development Host

## Project Structure

- Entry point: `src/extension.ts`
- Output: `out/` (generated, never edit manually)
- Three tree views: `cmakerunner.presets`, `cmakerunner.targets`, `cmakerunner.gtests`
- Services: `src/services/` (preset, target, mapping, workflow, config, output, windowsTooling)
- UI providers: `src/ui/` (preset, target, gtest tree data providers)

## Key Details

- Activates when workspace contains `CMakePresets.json`
- Target discovery via CMake File API (reads `<binaryDir>/.cmake/api/v1/reply/`)
- Configure always writes `codemodel-v2` query file
- Requires successful configure before targets appear
- Uses VS Code Tasks API and Debug API for build/run/debug

## Extension Commands

| Command | Description |
|---------|-------------|
| `cmakerunner.refresh` | Refresh presets and targets |
| `cmakerunner.selectPreset` | Choose the active configure preset |
| `cmakerunner.buildPreset` | Run preset configure |
| `cmakerunner.rebuildPreset` | Re-run preset configure |
| `cmakerunner.buildTarget` | Build target |
| `cmakerunner.buildTargetFromCurrentFile` | Build target from active source file |
| `cmakerunner.runTarget` | Run target |
| `cmakerunner.runGTestCase` | Build target and run a GoogleTest case |
| `cmakerunner.debugTarget` | Debug target |
| `cmakerunner.filterTargets` | Filter targets view |
| `cmakerunner.clearTargetFilter` | Clear target filter |
| `cmakerunner.refreshGTests` | Refresh GTests view |
| `cmakerunner.filterGTests` | Filter GTests view |
| `cmakerunner.clearGTestFilter` | Clear GTest filter |

## Test Commands

```bash
npm test
```
