import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from './models';
import { ConfigurationManager } from './services/configurationManager';
import { MappingEngine } from './services/mappingEngine';
import { OutputLogger } from './services/outputLogger';
import { PresetProvider } from './services/presetProvider';
import { TaskExecutionEngine } from './services/taskExecutionEngine';
import { GTestTestController } from './services/testController';
import { WorkflowManager } from './services/workflowManager';
import { getRegexFilterError } from './ui/filterMatcher';
import { PresetTreeDataProvider, PresetTreeItem } from './ui/presetTreeDataProvider';
import { SourceTreeItem, TargetTreeDataProvider, TargetTreeItem } from './ui/targetTreeDataProvider';
import { relativeDisplayPath } from './utils';

interface TargetQuickPickItem extends vscode.QuickPickItem {
  readonly target?: TargetInfo;
}

interface RegexFilterQuickPickItem extends vscode.QuickPickItem {
  readonly regexText: string;
}

type RegexFilterPick<T extends vscode.QuickPickItem> =
  | { readonly type: 'item'; readonly item: T }
  | { readonly type: 'regex'; readonly filterText: string };

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
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
  let presets: PresetInfo[] = [];
  let currentPreset: PresetInfo | undefined;
  let initializationPromise: Promise<void> | undefined;

  const refreshPresetTree = (): void => {
    presetTreeDataProvider.setPresets(presets, currentPreset?.name);
  };

  const refresh = async (preferredPresetName?: string): Promise<void> => {
    presets = await presetProvider.loadPresets();
    const storedPresetName = preferredPresetName ?? context.workspaceState.get<string>('cmakerunner.selectedPreset');
    currentPreset = presets.find((preset) => preset.name === storedPresetName) ?? presets[0];

    if (currentPreset) {
      await context.workspaceState.update('cmakerunner.selectedPreset', currentPreset.name);
    }

    presetTreeDataProvider.setPresets(presets, currentPreset?.name);
    testController.setPreset(currentPreset);
  };

  const updateTargets = async (): Promise<void> => {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    logger.info(`Updating targets. preset=${currentPreset?.name ?? 'none'}, activeFile=${activeFile ?? 'none'}`);

    if (currentPreset) {
      await mappingEngine.rebuild(currentPreset);
      const targets = mappingEngine.getTargets();
      targetTreeDataProvider.setTargets(targets, currentPreset.sourceDir, activeFile);
      testController.setPreset(currentPreset);
      testController.setTargets(targets);
      await updateTargetViewState();
      return;
    }

    logger.warn('Skipping target update because no preset is selected');
    targetTreeDataProvider.setTargets([], workspaceRoot, activeFile);
    testController.setPreset(undefined);
    testController.setTargets([]);
    await updateTargetViewState();
  };

  const ensureInitialized = async (): Promise<void> => {
    if (initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = (async () => {
      await refresh();
      await updateTargets();
    })().catch((error) => {
      initializationPromise = undefined;
      throw error;
    });

    return initializationPromise;
  };

  const testController = new GTestTestController(configurationManager, logger, ensureInitialized);
  const workflowManager = new WorkflowManager(
    configurationManager,
    taskExecutionEngine,
    logger,
    async (preset, target) => {
      testController.setPreset(preset);
      testController.setTargets(mappingEngine.getTargets());
      await testController.discover();
      logger.info(`Refreshed GoogleTest cases after building ${target.name}`);
    },
  );
  const presetTreeDataProvider = new PresetTreeDataProvider();
  const targetTreeDataProvider = new TargetTreeDataProvider();

  logger.info(`Extension activated for workspace: ${workspaceRoot}`);

  const presetsTreeView = vscode.window.createTreeView('cmakerunner.presets', {
    treeDataProvider: presetTreeDataProvider,
    showCollapseAll: false,
  });

  const targetsTreeView = vscode.window.createTreeView('cmakerunner.targets', {
    treeDataProvider: targetTreeDataProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(outputChannel, presetsTreeView, targetsTreeView, testController);

  const updateTargetViewState = async (): Promise<void> => {
    const filterText = targetTreeDataProvider.getFilterText();
    targetsTreeView.description = filterText
      ? `${targetTreeDataProvider.isFilterRegex() ? 'Regex' : 'Filter'}: ${filterText}`
      : undefined;
    targetsTreeView.message = filterText && targetTreeDataProvider.getVisibleTargetCount() === 0
      ? 'No executable target matches the current filter.'
      : undefined;
    await vscode.commands.executeCommand('setContext', 'cmakerunner.targetsFilterActive', !!filterText);
  };

  const applyTargetFilter = async (filterText: string, options?: { isRegex?: boolean }): Promise<void> => {
    targetTreeDataProvider.setFilterText(filterText, options);
    await updateTargetViewState();
  };

  const getTargetType = (target: TargetInfo): string => target.type ?? 'EXECUTABLE';
  const isRunnableTarget = (target: TargetInfo): boolean => getTargetType(target) === 'EXECUTABLE';

  const ensureRunnableTarget = (target: TargetInfo, action: string): boolean => {
    if (isRunnableTarget(target)) {
      return true;
    }

    void vscode.window.showWarningMessage(
      `Target ${target.displayName} is a ${getTargetType(target)} target and cannot be ${action}. Only EXECUTABLE targets are supported for this command.`,
    );
    return false;
  };

  const selectTarget = async (target: TargetInfo | undefined): Promise<void> => {
    if (!target) {
      return;
    }

    const targetTreeItem = targetTreeDataProvider.findTargetItem(target.id);
    if (!targetTreeItem) {
      return;
    }

    try {
      await targetsTreeView.reveal(targetTreeItem, { select: true, focus: false, expand: false });
    } catch {
      // ignore
    }
  };

  const selectPreset = async (preset: PresetInfo): Promise<void> => {
    logger.info(`Selecting preset: ${preset.name}`);
    currentPreset = preset;
    testController.setPreset(currentPreset);
    await context.workspaceState.update('cmakerunner.selectedPreset', currentPreset.name);
    presetTreeDataProvider.setPresets(presets, currentPreset.name);

    const presetTreeItem = presetTreeDataProvider.findItem(currentPreset.name);
    if (presetTreeItem) {
      try {
        await presetsTreeView.reveal(presetTreeItem, { select: true, focus: false });
      } catch {
        // ignore
      }
    }
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
      return value.target;
    }

    if (value instanceof SourceTreeItem) {
      const target = mappingEngine.findTargetsBySource(value.sourcePath)[0];
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

  const createTargetQuickPickItems = (targets: readonly TargetInfo[]): TargetQuickPickItem[] => {
    const quickPickSourceDir = currentPreset?.sourceDir ?? workspaceRoot;
    return targets.map((target) => ({
      label: target.displayName,
      description: path.basename(target.guessedExecutablePath),
      detail: `${target.sourceFiles.length} source file${target.sourceFiles.length === 1 ? '' : 's'}: ${target.sourceFiles
        .map((sourcePath) => relativeDisplayPath(sourcePath, quickPickSourceDir))
        .join(', ')}`,
      target,
    }));
  };

  const showPresetBuildSuccess = (preset: PresetInfo, actionLabel: string, durationMs: number): void => {
    void vscode.window.showInformationMessage(
      `Preset ${preset.displayName} ${actionLabel} successfully in ${formatDuration(durationMs)}.`,
    );
  };

  const pickTarget = async (options?: { userActiveFile?: boolean }): Promise<TargetQuickPickItem | undefined> => {
    const targets = getAutoFilteredTargets(options?.userActiveFile == true);
    if (!ensureDiscoveredTargets(targets)) {
      return undefined;
    }

    const items = createTargetQuickPickItems(targets);

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

  const pickRegexFilter = async <T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: {
      readonly title: string;
      readonly placeHolder: string;
      readonly regexDetail: string;
      readonly matchOnDescription?: boolean;
      readonly matchOnDetail?: boolean;
    },
  ): Promise<RegexFilterPick<T> | undefined> => {
    return new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick<T | RegexFilterQuickPickItem>();
      let settled = false;

      const finish = (result: RegexFilterPick<T> | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
        quickPick.hide();
        quickPick.dispose();
      };

      const createRegexItem = (regexText: string): RegexFilterQuickPickItem => ({
        label: `$(regex) Apply regex: ${regexText}`,
        description: 'Press Enter to show all matches',
        detail: options.regexDetail,
        alwaysShow: true,
        regexText,
      });

      const updateItems = (value: string): void => {
        const regexText = value.trim();
        if (!regexText) {
          quickPick.items = [...items];
          return;
        }

        const regexItem = createRegexItem(regexText);
        quickPick.items = [regexItem, ...items];
        quickPick.activeItems = [regexItem];
      };

      quickPick.title = options.title;
      quickPick.value = '';
      quickPick.placeholder = options.placeHolder;
      quickPick.ignoreFocusOut = true;
      quickPick.matchOnDescription = options.matchOnDescription ?? false;
      quickPick.matchOnDetail = options.matchOnDetail ?? false;
      quickPick.items = [...items];
      quickPick.onDidChangeValue(updateItems);
      quickPick.onDidAccept(() => {
        const pickedItem = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
        if (!pickedItem) {
          finish(undefined);
          return;
        }

        if ('regexText' in pickedItem) {
          const error = getRegexFilterError(pickedItem.regexText);
          if (error) {
            void vscode.window.showWarningMessage(`Invalid regular expression: ${error}`);
            finish(undefined);
            return;
          }

          finish({
            type: 'regex',
            filterText: pickedItem.regexText,
          });
          return;
        }

        finish({
          type: 'item',
          item: pickedItem as T,
        });
      });
      quickPick.onDidHide(() => finish(undefined));
      quickPick.show();
    });
  };

  const pickTargetFilter = async (): Promise<RegexFilterPick<TargetQuickPickItem> | undefined> => {
    const targets = getAutoFilteredTargets(false);
    if (!ensureDiscoveredTargets(targets)) {
      return undefined;
    }

    const items = createTargetQuickPickItems(targets);

    return pickRegexFilter(items, {
      title: 'Filter Targets',
      placeHolder: 'Example: app, main\\.cpp, ^Test.*',
      regexDetail: 'Match target names, executable names, and source paths',
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

  const initializeOnVisibleView = async (): Promise<void> => {
    await ensureInitialized();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('cmakerunner.refresh', async () => {
      await ensureInitialized();
      await refresh(currentPreset?.name);
      await updateTargets();
    }),
    vscode.commands.registerCommand('cmakerunner.filterTargets', async () => {
      await ensureInitialized();
      const pick = await pickTargetFilter();
      if (!pick) {
        return;
      }

      if (pick.type === 'regex') {
        await applyTargetFilter(pick.filterText, { isRegex: true });
        return;
      }

      if (pick.item.target) {
        await applyTargetFilter(pick.item.target.displayName);
        await selectTarget(pick.item.target);
        return;
      }
    }),
    vscode.commands.registerCommand('cmakerunner.clearTargetFilter', async () => {
      await ensureInitialized();
      await applyTargetFilter('');
    }),
    vscode.commands.registerCommand('cmakerunner.refreshGTests', async () => {
      await testController.discover();
    }),
    vscode.commands.registerCommand('cmakerunner.selectPreset', async (item?: PresetTreeItem) => {
      await ensureInitialized();
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
      await ensureInitialized();
      const preset = item?.preset ?? ensurePreset();
      if (!preset) {
        return;
      }

      if (currentPreset?.name !== preset.name) {
        await selectPreset(preset);
      }

      const buildResult = await workflowManager.buildPreset(preset);
      if (!buildResult.succeeded) {
        return;
      }

      refreshPresetTree();
      await updateTargets();
      showPresetBuildSuccess(preset, 'configured', buildResult.durationMs);
    }),
    vscode.commands.registerCommand('cmakerunner.rebuildPreset', async (item?: PresetTreeItem) => {
      await ensureInitialized();
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

      const buildResult = await workflowManager.buildPreset(preset);
      if (!buildResult.succeeded) {
        return;
      }

      refreshPresetTree();
      await updateTargets();
      showPresetBuildSuccess(preset, 'rebuilt', buildResult.durationMs);
    }),
    vscode.commands.registerCommand('cmakerunner.buildTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      await ensureInitialized();
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await selectTarget(target);
      await workflowManager.buildTarget(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.buildTargetFromCurrentFile', async () => {
      await ensureInitialized();
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const pick = await pickTarget({ userActiveFile: true });
      if (!pick?.target) {
        return;
      }

      if (pick.target) {
        await applyTargetFilter(pick.target.displayName);
      }

      await selectTarget(pick.target);
      await workflowManager.buildTarget(preset, pick.target);
    }),
    vscode.commands.registerCommand('cmakerunner.runTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      await ensureInitialized();
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await selectTarget(target);
      if (!ensureRunnableTarget(target, 'run')) {
        return;
      }
      await workflowManager.runTarget(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.debugTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      await ensureInitialized();
      const preset = ensurePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await selectTarget(target);
      if (!ensureRunnableTarget(target, 'debugged')) {
        return;
      }
      await workflowManager.debugTarget(preset, target);
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      await revealActiveSource(editor?.document.uri.fsPath);
    }),
  );

  if (presetsTreeView.visible || targetsTreeView.visible) {
    void initializeOnVisibleView();
  }

  if ('onDidChangeVisibility' in presetsTreeView) {
    context.subscriptions.push((presetsTreeView as vscode.TreeView<PresetTreeItem>).onDidChangeVisibility(async () => {
      if (presetsTreeView.visible) {
        await initializeOnVisibleView();
      }
    }));
  }

  if ('onDidChangeVisibility' in targetsTreeView) {
    context.subscriptions.push((targetsTreeView as vscode.TreeView<TargetTreeItem | SourceTreeItem>).onDidChangeVisibility(async () => {
      if (targetsTreeView.visible) {
        await initializeOnVisibleView();
      }
    }));
  }
}

export function deactivate(): void {
  // no-op
}
