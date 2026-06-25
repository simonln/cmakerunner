# CMake Runner

## V0.4.5 2026-06-25
### Bug Fixes
* Fix a VS Code Test Explorer error caused by duplicate GoogleTest item IDs during test case scanning and source-location refresh


## V0.4.4 2026-06-24
### Enhancements
* Activate when the workspace contains `CMakeUserPresets.json` in addition to `CMakePresets.json`
* Register Test Explorer integration after VS Code startup so GoogleTest refresh is available earlier

### Bug Fixes
* Defer preset loading and target discovery until a CMake Runner view, command, or Test Explorer action actually needs them
* Reduce startup overhead by keeping `onStartupFinished` activation lightweight

## V0.4.3 2026-06-02
### Enhancements
* Show preset configure success notifications with build duration only
* Remove target details from preset configure success notifications

## V0.4.2 2026-06-01
### Bug Fixes
*  improve Google Test source location discovery and test controller performance， prevent overall jamming


## V0.4.1 2026-05-30
### Bug Fixes
* Automatically refresh GoogleTest cases in VS Code Testing after a target build completes successfully

## V0.4.0 2026-05-30
### Enhancements
* Move GoogleTest integration from the custom `GTests` view to VS Code Test Explorer
* Discover GoogleTest cases by scanning executable files under the active preset build directory
* Support Test Explorer run/debug actions for GoogleTest cases
* Start debugger sessions directly with the installed C/C++ debugger instead of writing `launch.json`

### Breaking Changes
* Remove `cmakerunner.debug.type`
* Remove custom GTests view commands and menus

## V0.3.4 2026-05-28
### Enhancements
* Expand mapped target types to `EXECUTABLE`, `SHARED_LIBRARY`, and `UTILITY`
* Keep run/debug/GoogleTest commands executable-only and show warnings for non-runnable target types

## V0.3.3 2026-05-26
### Enhancements
Continue running remaining GTest cases after failures


## V0.3.2 2026-05-25
### Enhancements
* Support regex filters for Targets and GTests

## V0.3.1 2026-05-20

### Bug Fixes
* Fix the default debugger configuration


## V0.3.0 2026-05-19
### Enhancements
* GTests support source navigation and per-case debugging

## V0.2.2 2026-05-18
### Bug Fixes
* Fixed an issue where gtest executed the entire target test case when a filter was present.

## V0.2.1 2026-05-17
### New Feature
### Enhancements
Require explicit run action for GTest cases

### Bug Fixes

## V0.2.0 2026-05-15
### New Feature

### Enhancements
* Fixed `GTESTS` view

### Bug Fixes
* Fixed the issue of "error success notification after compilation interruption".
