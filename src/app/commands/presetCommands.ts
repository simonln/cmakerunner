import * as vscode from 'vscode';
import { PresetInfo } from '../../models';
import { clearPresetBuildDirectory } from '../../services/buildDirectoryCleaner';
import { PresetTreeItem } from '../../ui/presetTreeDataProvider';
import { formatDuration } from '../../utils';
import { ensurePreset } from '../commandGuards';
import { CommandContext } from './types';

export function registerPresetCommands(context: CommandContext): vscode.Disposable[] {
  const { store, sessionLoader, workflowManager, presetsView, logger } = context;

  const selectPreset = async (preset: PresetInfo): Promise<void> => {
    await store.selectPreset(preset);
    await presetsView.reveal(preset.name);
  };

  const runPresetBuild = async (preset: PresetInfo, displayVerb: string): Promise<void> => {
    const buildResult = await workflowManager.buildPreset(preset);
    if (!buildResult.succeeded) {
      return;
    }

    await sessionLoader.updateTargets();
    void vscode.window.showInformationMessage(
      `Preset ${preset.displayName} ${displayVerb} successfully in ${formatDuration(buildResult.durationMs)}.`,
    );
  };

  return [
    vscode.commands.registerCommand('cmakerunner.selectPreset', async (item?: PresetTreeItem) => {
      await sessionLoader.ensureInitialized();
      if (!item) {
        const pick = await vscode.window.showQuickPick(
          store.getPresets().map((preset) => ({ label: preset.displayName, description: preset.name, preset })),
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
      await sessionLoader.ensureInitialized();
      const preset = item?.preset ?? ensurePreset(store, logger);
      if (!preset) {
        return;
      }

      if (store.getCurrentPreset()?.name !== preset.name) {
        await selectPreset(preset);
      }

      await runPresetBuild(preset, 'configured');
    }),
    vscode.commands.registerCommand('cmakerunner.rebuildPreset', async (item?: PresetTreeItem) => {
      await sessionLoader.ensureInitialized();
      const preset = item?.preset ?? ensurePreset(store, logger);
      if (!preset) {
        return;
      }

      if (store.getCurrentPreset()?.name !== preset.name) {
        await selectPreset(preset);
      }

      const cleared = await clearPresetBuildDirectory(preset, logger);
      if (!cleared) {
        return;
      }

      await runPresetBuild(preset, 'rebuilt');
    }),
  ];
}
