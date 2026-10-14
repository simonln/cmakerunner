import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo } from '../models';
import { OutputLogger } from './outputLogger';

const KEPT_ENTRY_NAME = 'compile_commands.json';

export async function clearPresetBuildDirectory(preset: PresetInfo, logger: OutputLogger): Promise<boolean> {
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
    const entries = await vscode.workspace.fs.readDirectory(buildDirectoryUri);
    const removedEntries: string[] = [];

    for (const [name] of entries) {
      if (name === KEPT_ENTRY_NAME) {
        continue;
      }

      const targetUri = vscode.Uri.file(path.join(preset.binaryDir, name));
      await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: false });
      removedEntries.push(name);
    }

    logger.info(
      `Cleared build directory for preset ${preset.name}: removed ${removedEntries.length} entr${removedEntries.length === 1 ? 'y' : 'ies'}, kept ${KEPT_ENTRY_NAME}`,
    );

    return true;
  } catch (error) {
    logger.warn(`Unable to clear the build directory in ${preset.binaryDir}: ${error instanceof Error ? error.message : String(error)}`);
    void vscode.window.showErrorMessage(`Unable to clear the build directory for preset ${preset.displayName}.`);
    return false;
  }
}
