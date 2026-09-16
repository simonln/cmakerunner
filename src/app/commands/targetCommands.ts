import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../../models';
import { SourceTreeItem, TargetTreeItem } from '../../ui/targetTreeDataProvider';
import { ensurePreset, ensureRunnableTarget } from '../commandGuards';
import { CommandContext } from './types';

export function registerTargetCommands(context: CommandContext): vscode.Disposable[] {
  const { store, sessionLoader, workflowManager, targetsView, targetPicker, logger } = context;

  const resolveTargetFromArgument = async (value?: TargetTreeItem | SourceTreeItem): Promise<TargetInfo | undefined> => {
    if (value instanceof TargetTreeItem) {
      return value.target;
    }

    if (value instanceof SourceTreeItem) {
      return store.findTargetsBySource(value.sourcePath)[0];
    }

    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!activePath) {
      logger.warn('Unable to resolve target because there is no active editor');
      void vscode.window.showWarningMessage('No active source file is open, so no target can be resolved.');
      return undefined;
    }

    const target = store.findTargetsBySource(activePath)[0];
    if (!target) {
      logger.warn(`No target mapping found for active file: ${activePath}`);
      void vscode.window.showWarningMessage('The active source file is not mapped to any executable target.');
    }
    return target;
  };

  const resolvePreset = (): PresetInfo | undefined => ensurePreset(store, logger);

  return [
    vscode.commands.registerCommand('cmakerunner.buildTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      await sessionLoader.ensureInitialized();
      const preset = resolvePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await targetsView.revealTarget(target.id);
      await workflowManager.buildTarget(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.buildTargetFromCurrentFile', async () => {
      await sessionLoader.ensureInitialized();
      const preset = resolvePreset();
      if (!preset) {
        return;
      }

      const pick = await targetPicker.pickTarget({ userActiveFile: true });
      if (!pick?.target) {
        return;
      }

      await targetsView.applyFilter(pick.target.displayName);
      await targetsView.revealTarget(pick.target.id);
      await workflowManager.buildTarget(preset, pick.target);
    }),
    vscode.commands.registerCommand('cmakerunner.runTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      await sessionLoader.ensureInitialized();
      const preset = resolvePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await targetsView.revealTarget(target.id);
      if (!ensureRunnableTarget(target, 'run')) {
        return;
      }
      await workflowManager.runTarget(preset, target);
    }),
    vscode.commands.registerCommand('cmakerunner.debugTarget', async (item?: TargetTreeItem | SourceTreeItem) => {
      await sessionLoader.ensureInitialized();
      const preset = resolvePreset();
      if (!preset) {
        return;
      }

      const target = await resolveTargetFromArgument(item);
      if (!target) {
        return;
      }

      await targetsView.revealTarget(target.id);
      if (!ensureRunnableTarget(target, 'debugged')) {
        return;
      }
      await workflowManager.debugTarget(preset, target);
    }),
  ];
}
