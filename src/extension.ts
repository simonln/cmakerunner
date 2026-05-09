import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from './models';
import { ConfigurationManager } from './services/configurationManager';
import { MappingEngine } from './services/mappingEngine';
import { OutputLogger } from './services/outputLogger';
import { PresetProvider } from './services/presetProvider';
import { TaskExecutionEngine } from './services/taskExecutionEngine';
import { WorkflowManager } from './services/workflowManager';
import { GTestCaseTreeItem, GTestTargetTreeItem, GTestTreeDataProvider } from './ui/gtestTreeDataProvider';
import { PresetTreeDataProvider, PresetTreeItem } from './ui/presetTreeDataProvider';
import { SourceTreeItem, TargetTreeDataProvider, TargetTreeItem } from './ui/targetTreeDataProvider';
import { relativeDisplayPath } from './utils';

interface TargetQuickPickItem extends vscode.QuickPickItem {
  readonly target?: TargetInfo;
  readonly action?: 'customTextFilter';
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const outputChannel = vscode.window.createOutputChannel('CMake Runner');
  const logger = new OutputLogger(outputChannel);
  const configurationManager = new ConfigurationManager();
  const presetProvider = new PresetProvider(workspaceRoot, logger);
  const mappingEngine = new MappingEngine(logger);
  const taskExecutionEngine = new TaskExecutionEngine(workspaceRoot, configurationManager, logger);
  const workflowManager = new WorkflowManager(configurationManager, taskExecutionEngine, logger);
  const presetTreeDataProvider = new PresetTreeDataProvider();
  const targetTreeDataProvider = new TargetTreeDataProvider();
  const gtestTreeDataProvider = new GTestTreeDataProvider(async (target) => {
    const preset = ensurePreset();
    return preset ? workflowManager.listGTestCases(preset, target) : undefined;
  });

  logger.info(`Extension activated for workspace: ${workspaceRoot}`);

  const presetsTreeView = vscode.window.createTreeView('cmakerunner.presets', {
    treeDataProvider: presetTreeDataProvider,
    showCollapseAll: false,
  });

  const targetsTreeView = vscode.window.createTreeView('cmakerunner.targets', {
    treeDataProvider: targetTreeDataProvider,
    showCollapseAll: true,
  });

  const gtestsTreeView = vscode.window.createTreeView('cmakerunner.gtests', {
    treeDataProvider: gtestTreeDataProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(outputChannel, presetsTreeView, targetsTreeView, gtestsTreeView);

  const updateTargetViewState = async (): Promise<void> => {
    const filterText = targetTreeDataProvider.getFilterText();
    targetsTreeView.description = filterText ? `Filter: ${filterText}` : undefined;
    targetsTreeView.message = filterText && targetTreeDataProvider.getVisibleTargetCount() === 0
      ? 'No executable target matches the current filter.'
      : undefined;
    await vscode.commands.executeCommand('setContext', 'cmakerunner.targetsFilterActive', !!filterText);
  };

  const applyTargetFilter = async (filterText: string): Promise<void> => {
    targetTreeDataProvider.setFilterText(filterText);
    await updateTargetViewState();
  };

  const updateGTestViewState = async (): Promise<void> => {
    const filterText = gtestTreeDataProvider.getFilterText();
    gtestsTreeView.description = filterText ? `Filter: ${filterText}` : undefined;
    gtestsTreeView.message = filterText && await gtestTreeDataProvider.getVisibleTargetCount() === 0
      ? 'No GoogleTest target or case matches the current filter.'
      : undefined;
    await vscode.commands.executeCommand('setContext', 'cmakerunner.gtestsFilterActive', !!filterText);
  };

  const applyGTestFilter = async (filterText: string): Promise<void> => {
    gtestTreeDataProvider.setFilterText(filterText);
    await updateGTestViewState();
  };

  let presets: PresetInfo[] = [];
  let currentPreset: PresetInfo | undefined;

  const selectPreset = async (preset: PresetInfo): Promise<void> => {
    logger.info(`Selecting preset: ${preset.name}`);
    currentPreset = preset;
    await context.workspaceState.update('cmakerunner.selectedPreset', currentPreset.name);
    presetTreeDataProvider.setPresets(presets, currentPreset.name);
    // await updateTargets();

    const presetTreeItem = presetTreeDataProvider.findItem(currentPreset.name);
    if (presetTreeItem) {
      try {
        await presetsTreeView.reveal(presetTreeItem, { select: true, focus: false });
      } catch {
        // ignore
      }
    }
  };

  const updateTargets = async (): Promise<void> => {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    logger.info(`Updating targets. preset=${currentPreset?.name ?? 'none'}, activeFile=${activeFile ?? 'none'}`);

    if (currentPreset) {
      await mappingEngine.rebuild(currentPreset);
      const targets = mappingEngine.getTargets();
    //   logger.info(`Resolved ${targets.length} mapped target(s) for preset ${currentPreset.name}`);
      targetTreeDataProvider.setTargets(targets, currentPreset.sourceDir, activeFile);
      gtestTreeDataProvider.setTargets(targets);
      await updateTargetViewState();
      await updateGTestViewState();
    //   await revealActiveSource(activeFile);
      return;
    }

    logger.warn('Skipping target update because no preset is selected');
    targetTreeDataProvider.setTargets([], workspaceRoot, activeFile);
    gtestTreeDataProvider.setTargets([]);
    await updateTargetViewState();
    await updateGTestViewState();
  };

  const refresh = async (preferredPresetName?: string): Promise<void> => {
    // logger.info(`Refreshing presets. preferredPreset=${preferredPresetName ?? 'none'}`);
    presets = await presetProvider.loadPresets();
    const storedPresetName = preferredPresetName ?? context.workspaceState.get<string>('cmakerunner.selectedPreset');
    currentPreset = presets.find((preset) => preset.name === storedPresetName) ?? presets[0];

    if (currentPreset) {
      await context.workspaceState.update('cmakerunner.selectedPreset', currentPreset.name);
    }

    // logger.info(`Refresh completed. presets=${presets.length}, selected=${currentPreset?.name ?? 'none'}`);
    presetTreeDataProvider.setPresets(presets, currentPreset?.name);
    // await updateTargets();
  };

  const ensurePreset = (): PresetInfo | undefined => {
    if (!currentPreset) {
      logger.warn('No preset is available when a preset-dependent command was invoked');
      void vscode.window.showWarningMessage('No available CMake Configure Preset was found. Please check CMakePresets.json.');
      return undefined;
    }

    return currentPreset;
  };

  const clearPresetBuildDirectory = async (preset: PresetInfo): Promise<boolean> => {
    const buildDirectoryUri = vscode.Uri.file(preset.binaryDir);

    try {
      await vscode.workspace.fs.stat(buildDirectoryUri);
    } catch (error) {
      const code = (error as vscode.FileSystemError | undefined)?.code;
      if (code === 'FileNotFound') {
        logger.info(`Skipping build directory cleanup because it does not exist: ${preset.binaryDir}`);
        return true;
      }

      logger.warn(`Unable to inspect build directory ${preset.binaryDir}: ${error instanceof Error ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(`Unable to access build directory for preset ${preset.displayName}.`);
      return false;
    }

    try {
      const cmakeCleanupTargets = [
        '.cmake',
        'CMakeCache.txt',
        'CMakeFiles',
      ];

      const cleanedPaths: string[] = [];

      for (const targetName of cmakeCleanupTargets) {
        const targetUri = vscode.Uri.file(path.join(preset.binaryDir, targetName));

        try {
          await vscode.workspace.fs.stat(targetUri);
        } catch (error) {
          const code = (error as vscode.FileSystemError | undefined)?.code;
          if (code === 'FileNotFound') {
            continue;
          }

          throw error;
        }

        await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: false });
        cleanedPaths.push(targetUri.fsPath);
      }

      logger.info(
        `Cleaning CMake configure artifacts for preset ${preset.name}: ${cleanedPaths.length > 0 ? cleanedPaths.join(', ') : 'no known configure artifacts found'}`,
      );

      return true;
    } catch (error) {
      logger.warn(`Unable to clean CMake configure artifacts in ${preset.binaryDir}: ${error instanceof Error ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(`Unable to clean CMake configure artifacts for preset ${preset.displayName}.`);
      return false;
    }
  };

  const resolveTargetFromArgument = async (value?: TargetTreeItem | SourceTreeItem): Promise<TargetInfo | undefined> => {
    if (value instanceof TargetTreeItem) {
    //   logger.info(`Resolved target from tree item: ${value.target.name}`);
      return value.target;
    }

    if (value instanceof SourceTreeItem) {
      const target = mappingEngine.findTargetsBySource(value.sourcePath)[0];
    //   logger.info(`Resolved target from source item ${value.sourcePath}: ${target?.name ?? 'none'}`);
      return target;
    }

    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!activePath) {
      logger.warn('Unable to resolve target because there is no active editor');
      void vscode.window.showWarningMessage('No active source file is open, so no target can be resolved.');
      return undefined;
    }

    const target = mappingEngine.findTargetsBySource(activePath)[0];
    if (!target) {
      logger.warn(`No target mapping found for active file: ${activePath}`);
      void vscode.window.showWarningMessage('The active source file is not mapped to any executable target.');
    }
    // logger.info(`Resolved target from active editor ${activePath}: ${target?.name ?? 'none'}`);
    return target;
  };

  const getActiveEditorFilePath = (): string | undefined => {
    const documentUri = vscode.window.activeTextEditor?.document.uri;
    return documentUri?.scheme === 'file' ? documentUri.fsPath : undefined;
  };

  const getAutoFilteredTargets = (userActiveFile: boolean): TargetInfo[] => {
    const targets = mappingEngine.getTargets();
    if (userActiveFile) {
        const activeFilePath = getActiveEditorFilePath();
            if (!activeFilePath) {
            return targets;
        }

        const mappedTargets = mappingEngine.findTargetsBySource(activeFilePath);
        if (mappedTargets.length > 0) {
            return mappedTargets;
        }
    }

    return targets;
  };

  const ensureDiscoveredTargets = (targets: TargetInfo[]): boolean => {
    if (targets.length > 0) {
      return true;
    }

    const message = currentPreset
      ? `No executable targets are available for preset ${currentPreset.displayName}. Run Build on the preset first.`
      : 'No executable targets are available. Select and build a preset first.';
    void vscode.window.showWarningMessage(message);
    return false;
  };

  const pickTarget = async (options?: { userActiveFile?: boolean }): Promise<TargetQuickPickItem | undefined> => {
    const targets = getAutoFilteredTargets(options?.userActiveFile == true);
    if (!ensureDiscoveredTargets(targets)) {
      return undefined;
    }

    const quickPickSourceDir = currentPreset?.sourceDir ?? workspaceRoot;
    const items: TargetQuickPickItem[] = targets.map((target) => ({
      label: target.displayName,
      description: path.basename(target.guessedExecutablePath),
      detail: `${target.sourceFiles.length} source file${target.sourceFiles.length === 1 ? '' : 's'}: ${target.sourceFiles
        .map((sourcePath) => relativeDisplayPath(sourcePath, quickPickSourceDir))
        .join(', ')}`,
      target,
    }));

    if (options?.userActiveFile && items.length === 1) {
      return items[0];
    }

    const prompt = 'Filter targets by executable name or C/C++ source file name';
    const placeHolder= 'Example: app, main.cpp, demo.exe, src/test.cpp';
    return vscode.window.showQuickPick(items, {
      prompt,
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    });
  };

  const revealActiveSource = async (filePath: string | undefined): Promise<void> => {
    targetTreeDataProvider.setActiveSourcePath(filePath);

    if (!filePath || !targetsTreeView.visible) {
      return;
    }

    const sourceItem = targetTreeDataProvider.findFirstSourceItemByFile(filePath);
    if (!sourceItem) {
      logger.info(`Active file is not present in target tree: ${filePath}`);
      return;
    }

    try {
      await targetsTreeView.reveal(sourceItem, {
        select: false,
        focus: false,
        expand: false,
      });
    } catch (error) {
      logger.warn(`Unable to reveal active source ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('cmakerunner.refresh', async () => {
      await refresh(currentPreset?.name);
    }),
    vscode.commands.registerCommand('cmakerunner.filterTargets', async () => {
      const pick = await pickTarget();
      if (!pick) {
        return;
      }

      if (pick.target) {
        await applyTargetFilter(pick.target.displayName);
        return;
      }
    }),
    vscode.commands.registerCommand('cmakerunner.clearTargetFilter', async () => {
      await applyTargetFilter('');
    }),
    vscode.commands.registerCommand('cmakerunner.refreshGTests', async () => {
      gtestTreeDataProvider.refresh();
      await updateGTestViewState();
    }),
    vscode.commands.registerCommand('cmakerunner.filterGTests', async () => {
      const filterText = await vscode.window.showInputBox({
        prompt: 'Filter GoogleTest targets or cases',
        placeHolder: 'Example: gtest, MathTest, Adds, MathTest.Adds',
        value: gtestTreeDataProvider.getFilterText(),
      });
      if (filterText === undefined) {
        return;
      }

      await applyGTestFilter(filterText);
    }),
    vscode.commands.registerCommand('cmakerunner.clearGTestFilter', async () => {
      await applyGTestFilter('');
    }),
    vscode.commands.registerCommand('cmakerunner.selectPreset', async (item?: PresetTreeItem) => {
      if (!item) {
        const pick = await vscode.window.showQuickPick(
          presets.map((preset) => ({ label: preset.displayName, description: preset.name, preset })),
          { placeHolder: 'Select a CMake Configure Preset' },
        );

        if (!pick) {
          return;
        }

        await selectPreset(pick.preset);
        return;
      }

      await selectPreset(item.preset);
    }),
    vscode.commands.registerCommand('cmakerunner.buildPreset', async (item?: PresetTreeItem) => {
    //   logger.info(`Build preset command invoked. requestedPreset=${item?.preset.name ?? currentPreset?.name ?? 'none'}`);
      const preset = item?.preset ?? ensurePreset();
      if (!preset) {
        return;
      }

      if (currentPreset?.name !== preset.name) {
        await selectPreset(preset);
      }

      const configured = await workflowManager.buildPreset(preset);
      if (!configured) {
        return;
      }

      await updateTargets();

      const targets = mappingEngine.getTargets();
      const targetSummary = targets.length > 0
        ? targets.map((target) => target.displayName).join(', ')
        : 'No executable targets were found.';

      void vscode.window.showInformationMessage(
        `Preset ${preset.displayName} configured successfully. Targets: ${targetSummary}`,
      );
    }),
    vscode.commands.registerCommand('cmakerunner.rebuildPreset', async (item?: PresetTreeItem) => {
      const preset = item?.preset ?? ensurePreset();
      if (!preset) {
        return;
      }

      if (currentPreset?.name !== preset.name) {
        await selectPreset(preset);
      }

      const cleared = await clearPresetBuildDirectory(preset);
      if (!cleared) {
        return;
      }

      const configured = await workflowManager.buildPreset(preset);
      if (!configured) {
        return;
      }

      await updateTargets();

      const targets = mappingEngine.getTargets();
      const targetSummary = targets.length > 0
        ? targets.map((target) => target.displayName).join(', ')
        : 'No executable targets were found.';

      void vscode.window.showInformationMessage(
        `Preset ${preset.displayName} rebuilt successfully. Targets: ${targetSummary}`,
      );
    }),
    vscode.commands.registerCommand('cmakerunner.buildTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await workflowManager.buildTarget(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.buildTargetFromCurrentFile', async () => {
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const pick = await pickTarget({ userActiveFile: true });
      if (!pick?.target) {
        return;
      }

    // apply filter to target view
    if (pick.target) {
        await applyTargetFilter(pick.target.displayName);
      }

      await workflowManager.buildTarget(preset, pick.target);
    }),
    vscode.commands.registerCommand('cmakerunner.runTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await workflowManager.runTarget(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.runGTestCase', async (
      item?: TargetTreeItem | SourceTreeItem | GTestTargetTreeItem | GTestCaseTreeItem,
    ) => {
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      if (item instanceof GTestCaseTreeItem) {
        await workflowManager.runGTestCase(preset, item.target, true, item.testCase);
        return;
      }

      if (item instanceof GTestTargetTreeItem) {
        await workflowManager.runGTestCase(preset, item.target);
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await workflowManager.runGTestCase(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.debugTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await workflowManager.debugTarget(preset, target);
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      await revealActiveSource(editor?.document.uri.fsPath);
    }),
  );

  await refresh();
  await updateTargets();
}

export function deactivate(): void {
  // no-op
}
