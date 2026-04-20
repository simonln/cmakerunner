import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from './models';
import { ConfigurationManager } from './services/configurationManager';
import { MappingEngine } from './services/mappingEngine';
import { OutputLogger } from './services/outputLogger';
import { PresetProvider } from './services/presetProvider';
import { TaskExecutionEngine } from './services/taskExecutionEngine';
import { WorkflowManager } from './services/workflowManager';
import { PresetTreeDataProvider, PresetTreeItem } from './ui/presetTreeDataProvider';
import { SourceTreeItem, TargetTreeDataProvider, TargetTreeItem } from './ui/targetTreeDataProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const outputChannel = vscode.window.createOutputChannel('PSGM Runner');
  const logger = new OutputLogger(outputChannel);
  const configurationManager = new ConfigurationManager();
  const presetProvider = new PresetProvider(workspaceRoot, logger);
  const mappingEngine = new MappingEngine(logger);
  const taskExecutionEngine = new TaskExecutionEngine(workspaceRoot, configurationManager, logger);
  const workflowManager = new WorkflowManager(configurationManager, taskExecutionEngine, logger);
  const presetTreeDataProvider = new PresetTreeDataProvider();
  const targetTreeDataProvider = new TargetTreeDataProvider();

  logger.info(`Extension activated for workspace: ${workspaceRoot}`);

  const presetsTreeView = vscode.window.createTreeView('psgmrunner.presets', {
    treeDataProvider: presetTreeDataProvider,
    showCollapseAll: false,
  });

  const targetsTreeView = vscode.window.createTreeView('psgmrunner.targets', {
    treeDataProvider: targetTreeDataProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(outputChannel, presetsTreeView, targetsTreeView);

  const updateTargetViewState = async (): Promise<void> => {
    const filterText = targetTreeDataProvider.getFilterText();
    targetsTreeView.description = filterText ? `Filter: ${filterText}` : undefined;
    targetsTreeView.message = filterText && targetTreeDataProvider.getVisibleTargetCount() === 0
      ? 'No executable target matches the current filter.'
      : undefined;
    await vscode.commands.executeCommand('setContext', 'psgmrunner.targetsFilterActive', !!filterText);
  };

  const applyTargetFilter = async (filterText: string): Promise<void> => {
    targetTreeDataProvider.setFilterText(filterText);
    await updateTargetViewState();
  };

  let presets: PresetInfo[] = [];
  let currentPreset: PresetInfo | undefined;

  const selectPreset = async (preset: PresetInfo): Promise<void> => {
    logger.info(`Selecting preset: ${preset.name}`);
    currentPreset = preset;
    await context.workspaceState.update('psgmrunner.selectedPreset', currentPreset.name);
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
      await updateTargetViewState();
    //   await revealActiveSource(activeFile);
      return;
    }

    logger.warn('Skipping target update because no preset is selected');
    targetTreeDataProvider.setTargets([], workspaceRoot, activeFile);
    await updateTargetViewState();
  };

  const refresh = async (preferredPresetName?: string): Promise<void> => {
    // logger.info(`Refreshing presets. preferredPreset=${preferredPresetName ?? 'none'}`);
    presets = await presetProvider.loadPresets();
    const storedPresetName = preferredPresetName ?? context.workspaceState.get<string>('psgmrunner.selectedPreset');
    currentPreset = presets.find((preset) => preset.name === storedPresetName) ?? presets[0];

    if (currentPreset) {
      await context.workspaceState.update('psgmrunner.selectedPreset', currentPreset.name);
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
      logger.info(`Cleaning build directory for preset ${preset.name}: ${preset.binaryDir}`);
      await vscode.workspace.fs.delete(buildDirectoryUri, { recursive: true, useTrash: false });
      return true;
    } catch (error) {
      logger.warn(`Unable to clean build directory ${preset.binaryDir}: ${error instanceof Error ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(`Unable to clean build directory for preset ${preset.displayName}.`);
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

  const revealActiveSource = async (filePath: string | undefined): Promise<void> => {
    if (!filePath) {
      return;
    }

    targetTreeDataProvider.setActiveSourcePath(filePath);
    const sourceItem = targetTreeDataProvider.findFirstSourceItemByFile(filePath);
    if (!sourceItem) {
      logger.info(`Active file is not present in target tree: ${filePath}`);
      return;
    }

    try {
      await targetsTreeView.reveal(sourceItem, {
        select: true,
        focus: false,
        expand: true,
      });
    } catch (error) {
      logger.warn(`Unable to reveal active source ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('psgmrunner.refresh', async () => {
      await refresh(currentPreset?.name);
    }),
    vscode.commands.registerCommand('psgmrunner.filterTargets', async () => {
      const filterText = await vscode.window.showInputBox({
        prompt: 'Filter targets by executable name or C/C++ source file name',
        placeHolder: 'Example: app, main.cpp, demo.exe',
        value: targetTreeDataProvider.getFilterText(),
      });

      if (filterText === undefined) {
        return;
      }

      await applyTargetFilter(filterText);
    }),
    vscode.commands.registerCommand('psgmrunner.clearTargetFilter', async () => {
      await applyTargetFilter('');
    }),
    vscode.commands.registerCommand('psgmrunner.selectPreset', async (item?: PresetTreeItem) => {
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
    vscode.commands.registerCommand('psgmrunner.buildPreset', async (item?: PresetTreeItem) => {
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
    vscode.commands.registerCommand('psgmrunner.rebuildPreset', async (item?: PresetTreeItem) => {
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
    vscode.commands.registerCommand('psgmrunner.buildTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
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
    vscode.commands.registerCommand('psgmrunner.runTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
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
    vscode.commands.registerCommand('psgmrunner.debugTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
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
