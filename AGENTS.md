# AGENTS.md

## Developer Commands

```bash
npm install            # Install dependencies
npm run compile        # Compile TypeScript to out/
npm run watch         # Watch mode for development
npm run package:vsix    # Build VSIX to dist/
```

- Press **F5** in VS Code to debug the extension in Extension Development Host

## Project Structure

- Entry point: `src/extension.ts` (composition root only; services/views/commands are wired here)
- State: `src/app/sessionStore.ts` is the single source of truth (presets, targets, active source) and publishes change events
- Orchestration: `src/app/sessionLoader.ts` (lazy init, refresh, target rebuild); commands live in `src/app/commands/`
- Output: `out/` (generated, never edit manually)
- Two tree views: `cmakerunner.presets`, `cmakerunner.targets` (wrapped by `src/ui/presetsView.ts` / `src/ui/targetsView.ts`)
- Services: `src/services/` (preset, mapping, workflow, task execution, process runner, config, output, windowsTooling, Test Explorer integration)
- UI providers: `src/ui/` (tree data providers, view wrappers, target picker, filter matcher)

## Key Details

- Activates when workspace contains `CMakePresets.json` or `CMakeUserPresets.json`, and completes activation after VS Code startup (`onStartupFinished`)
- Target discovery via CMake File API (reads `<binaryDir>/.cmake/api/v1/reply/`); `MappingEngine.build()` is stateless and returns an empty mapping when the reply is missing
- Configure always writes `codemodel-v2` query file
- Requires successful configure before targets appear
- Uses VS Code Tasks API and Debug API for build/run/debug
- GoogleTest cases are registered in VS Code Test Explorer from discovered `EXECUTABLE` targets whose executable file name matches `cmakerunner.gtests.executablePatterns` (default `test*`, case-insensitive), probed with `--gtest_list_tests`
- Test runs use `cmakerunner.gtests.caseTimeoutMs` (default 60000 ms, `0` disables) and can be cancelled; cancelling kills the case process tree via `src/services/processRunner.ts`

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
| `cmakerunner.debugTarget` | Debug target |
| `cmakerunner.filterTargets` | Filter targets view |
| `cmakerunner.clearTargetFilter` | Clear target filter |
| `cmakerunner.refreshGTests` | Refresh Test Explorer GoogleTest items |

## Test Commands

```bash
npm test               # compile + run all mocha suites
npm run test:coverage  # compile + run all suites with c8 coverage
```
