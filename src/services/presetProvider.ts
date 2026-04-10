import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo } from '../models';
import { replaceTemplateVariables, toAbsolutePath } from '../utils';
import { OutputLogger } from './outputLogger';

interface RawPreset {
  readonly name?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly hidden?: boolean;
  readonly binaryDir?: string;
  readonly inherits?: string | string[];
}

interface RawPresetFile {
  readonly configurePresets?: RawPreset[];
}

export class PresetProvider {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly logger: OutputLogger,
  ) {}

  public async loadPresets(): Promise<PresetInfo[]> {
    const presetsPath = vscode.Uri.file(path.join(this.workspaceRoot, 'CMakePresets.json'));
    let content: Uint8Array;

    this.logger.info(`Loading presets from ${presetsPath.fsPath}`);

    try {
      content = await vscode.workspace.fs.readFile(presetsPath);
    } catch (error) {
      this.logger.warn(`Unable to read presets file ${presetsPath.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }

    const parsed = JSON.parse(Buffer.from(content).toString('utf8')) as RawPresetFile;
    const configurePresets = Array.isArray(parsed.configurePresets) ? parsed.configurePresets : [];
    const presetMap = new Map(configurePresets.filter((preset) => preset.name).map((preset) => [preset.name as string, preset]));

    const resolvePreset = (presetName: string, trail: Set<string>): RawPreset => {
      const preset = presetMap.get(presetName);
      if (!preset) {
        return {};
      }

      if (trail.has(presetName)) {
        return preset;
      }

      const nextTrail = new Set(trail);
      nextTrail.add(presetName);

      const inheritedPresets = Array.isArray(preset.inherits)
        ? preset.inherits
        : preset.inherits
          ? [preset.inherits]
          : [];

      const mergedParent = inheritedPresets.reduce<RawPreset>((accumulator, inheritedName) => {
        return { ...accumulator, ...resolvePreset(inheritedName, nextTrail) };
      }, {});

      return { ...mergedParent, ...preset };
    };

    const presets = configurePresets
      .filter((preset) => preset.name)
      .map((preset) => resolvePreset(preset.name as string, new Set<string>()))
      .filter((preset) => !preset.hidden && !!preset.name && !!preset.binaryDir)
      .map((preset) => {
        const variables = {
          sourceDir: this.workspaceRoot,
          workspaceFolder: this.workspaceRoot,
        };
        const resolvedBinaryDir = replaceTemplateVariables(preset.binaryDir as string, variables);

        return {
          name: preset.name as string,
          displayName: preset.displayName ?? (preset.name as string),
          binaryDir: toAbsolutePath(resolvedBinaryDir, this.workspaceRoot),
          sourceDir: this.workspaceRoot,
          description: preset.description,
        } satisfies PresetInfo;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    this.logger.info(`Loaded ${presets.length} visible configure preset(s)`);
    return presets;
  }
}
