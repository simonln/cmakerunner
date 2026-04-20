import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { PresetInfo } from '../models';
import { parseJsonBuffer, replaceTemplateVariables, toAbsolutePath } from '../utils';
import { OutputLogger } from './outputLogger';

const execFileAsync = promisify(execFile);

interface RawPreset {
  readonly name?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly hidden?: boolean;
  readonly binaryDir?: string;
  readonly inherits?: string | string[];
}

interface RawPresetFile {
  readonly include?: string[];
  readonly configurePresets?: RawPreset[];
  readonly buildPresets?: RawBuildPreset[];
}

interface RawBuildPreset {
  readonly name?: string;
  readonly displayName?: string;
  readonly hidden?: boolean;
  readonly configurePreset?: string;
  readonly configuration?: string;
  readonly inherits?: string | string[];
}

interface ListedPreset {
  readonly name: string;
  readonly displayName?: string;
}

export class PresetProvider {
  private resolvedCMakeExecutable: string | undefined;

  public constructor(
    private readonly workspaceRoot: string,
    private readonly logger: OutputLogger,
  ) {}

  public async loadPresets(): Promise<PresetInfo[]> {
    const [listedConfigurePresets, listedBuildPresets, loadedPresetFiles] = await Promise.all([
      this.listPresetsFromCMake('configure'),
      this.listPresetsFromCMake('build'),
      this.loadPresetFiles(),
    ]);

    const configurePresets = loadedPresetFiles.configurePresets;
    const buildPresets = loadedPresetFiles.buildPresets;

    if (configurePresets.length === 0 && listedConfigurePresets.length === 0) {
      return [];
    }

    const presetMap = new Map(configurePresets.filter((preset) => preset.name).map((preset) => [preset.name as string, preset]));
    const buildPresetMap = new Map(buildPresets.filter((preset) => preset.name).map((preset) => [preset.name as string, preset]));
    const listedConfigurePresetMap = new Map(listedConfigurePresets.map((preset) => [preset.name, preset]));
    const listedBuildPresetNames = new Set(listedBuildPresets.map((preset) => preset.name));

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

    const resolveBuildPreset = (presetName: string, trail: Set<string>): RawBuildPreset => {
      const preset = buildPresetMap.get(presetName);
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

      const mergedParent = inheritedPresets.reduce<RawBuildPreset>((accumulator, inheritedName) => {
        return { ...accumulator, ...resolveBuildPreset(inheritedName, nextTrail) };
      }, {});

      return { ...mergedParent, ...preset };
    };

    const resolvedBuildPresets = buildPresets
      .filter((preset) => preset.name)
      .map((preset) => resolveBuildPreset(preset.name as string, new Set<string>()))
      .filter((preset) => {
        if (!preset.name || !preset.configurePreset) {
          return false;
        }

        if (listedBuildPresetNames.size > 0) {
          return listedBuildPresetNames.has(preset.name);
        }

        return !preset.hidden;
      });

    const buildPresetByConfigurePreset = new Map<string, RawBuildPreset>();
    for (const buildPreset of resolvedBuildPresets) {
      const configurePresetName = buildPreset.configurePreset as string;
      const existing = buildPresetByConfigurePreset.get(configurePresetName);
      if (!existing || buildPreset.name === configurePresetName) {
        buildPresetByConfigurePreset.set(configurePresetName, buildPreset);
      }
    }

    const presets = configurePresets
      .filter((preset) => preset.name)
      .map((preset) => resolvePreset(preset.name as string, new Set<string>()))
      .filter((preset) => {
        if (!preset.name || !preset.binaryDir) {
          return false;
        }

        if (listedConfigurePresetMap.size > 0) {
          return listedConfigurePresetMap.has(preset.name);
        }

        return !preset.hidden;
      })
      .map((preset) => {
        const matchingBuildPreset = buildPresetByConfigurePreset.get(preset.name as string);
        const variables = {
          presetName: preset.name,
          sourceDir: this.workspaceRoot,
          workspaceFolder: this.workspaceRoot,
        };
        const resolvedBinaryDir = replaceTemplateVariables(preset.binaryDir as string, variables);

        return {
          name: preset.name as string,
          displayName: listedConfigurePresetMap.get(preset.name as string)?.displayName ?? preset.displayName ?? (preset.name as string),
          binaryDir: toAbsolutePath(resolvedBinaryDir, this.workspaceRoot),
          sourceDir: this.workspaceRoot,
          buildPresetName: matchingBuildPreset?.name,
          configuration: matchingBuildPreset?.configuration,
          description: preset.description,
        } satisfies PresetInfo;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    // this.logger.info(`Loaded ${presets.length} visible configure preset(s)`);
    return presets;
  }

  private async listPresetsFromCMake(type: 'configure' | 'build'): Promise<ListedPreset[]> {
    const cmakeExecutable = await this.resolveCMakeExecutable();

    try {
      const { stdout } = await execFileAsync(cmakeExecutable, ['-S', this.workspaceRoot, `--list-presets=${type}`], {
        cwd: this.workspaceRoot,
        windowsHide: true,
      });

      const presets: ListedPreset[] = [];
      for (const line of stdout.split(/\r?\n/).map((item) => item.trim())) {
        const match = line.match(/^"([^"]+)"(?:\s+-\s+(.+))?$/);
        if (!match) {
          continue;
        }

        presets.push({
          name: match[1],
          displayName: match[2],
        });
      }

      return presets;
    } catch (error) {
      this.logger.warn(
        `Unable to query ${type} presets from CMake (${cmakeExecutable}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async resolveCMakeExecutable(): Promise<string> {
    if (this.resolvedCMakeExecutable) {
      return this.resolvedCMakeExecutable;
    }

    const configuredPath = vscode.workspace.getConfiguration('psgmrunner').get<string>('cmakePath', '').trim();
    if (configuredPath) {
      if (path.isAbsolute(configuredPath) && !fs.existsSync(configuredPath)) {
        this.logger.warn(`Configured psgmrunner.cmakePath does not exist: ${configuredPath}`);
      } else {
        this.resolvedCMakeExecutable = configuredPath;
        return configuredPath;
      }
    }

    if (process.platform === 'win32') {
      const fromWhere = await this.findCMakeFromWhere();
      if (fromWhere) {
        this.resolvedCMakeExecutable = fromWhere;
        return fromWhere;
      }

      const fromVsWhere = await this.findCMakeFromVsWhere();
      if (fromVsWhere) {
        this.resolvedCMakeExecutable = fromVsWhere;
        return fromVsWhere;
      }
    }

    this.resolvedCMakeExecutable = 'cmake';
    return this.resolvedCMakeExecutable;
  }

  private async findCMakeFromWhere(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('where.exe', ['cmake'], { windowsHide: true });
      const firstMatch = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      return firstMatch;
    } catch {
      return undefined;
    }
  }

  private async findCMakeFromVsWhere(): Promise<string | undefined> {
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles;
    if (!programFilesX86) {
      return undefined;
    }

    const vswherePath = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!fs.existsSync(vswherePath)) {
      return undefined;
    }

    try {
      const { stdout } = await execFileAsync(vswherePath, [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.CMake.Project',
        '-find',
        'Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe',
      ], {
        windowsHide: true,
      });
      const firstMatch = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      return firstMatch;
    } catch {
      return undefined;
    }
  }

  private async loadPresetFiles(): Promise<{ configurePresets: RawPreset[]; buildPresets: RawBuildPreset[] }> {
    const configurePresets: RawPreset[] = [];
    const buildPresets: RawBuildPreset[] = [];
    const visitedFiles = new Set<string>();

    for (const rootFileName of ['CMakePresets.json', 'CMakeUserPresets.json']) {
      const rootFilePath = path.join(this.workspaceRoot, rootFileName);
      const presetFile = await this.readPresetFile(rootFilePath, visitedFiles);
      if (!presetFile) {
        continue;
      }

      configurePresets.push(...presetFile.configurePresets);
      buildPresets.push(...presetFile.buildPresets);
    }

    return { configurePresets, buildPresets };
  }

  private async readPresetFile(
    filePath: string,
    visitedFiles: Set<string>,
  ): Promise<{ configurePresets: RawPreset[]; buildPresets: RawBuildPreset[] } | undefined> {
    const normalizedFilePath = path.normalize(filePath);
    if (visitedFiles.has(normalizedFilePath)) {
      return {
        configurePresets: [],
        buildPresets: [],
      };
    }

    const uri = vscode.Uri.file(filePath);
    let rawPresetFile: RawPresetFile;

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      rawPresetFile = parseJsonBuffer<RawPresetFile>(content).value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'FileNotFound') {
        this.logger.warn(`Unable to read presets file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }

      return undefined;
    }

    visitedFiles.add(normalizedFilePath);

    const configurePresets: RawPreset[] = [];
    const buildPresets: RawBuildPreset[] = [];
    const includes = Array.isArray(rawPresetFile.include) ? rawPresetFile.include : [];

    for (const includePath of includes) {
      const nestedFilePath = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(path.dirname(filePath), includePath);
      const nestedPresetFile = await this.readPresetFile(nestedFilePath, visitedFiles);
      if (!nestedPresetFile) {
        continue;
      }

      configurePresets.push(...nestedPresetFile.configurePresets);
      buildPresets.push(...nestedPresetFile.buildPresets);
    }

    configurePresets.push(...(Array.isArray(rawPresetFile.configurePresets) ? rawPresetFile.configurePresets : []));
    buildPresets.push(...(Array.isArray(rawPresetFile.buildPresets) ? rawPresetFile.buildPresets : []));

    return { configurePresets, buildPresets };
  }
}
