import * as path from 'path';
import * as vscode from 'vscode';
import { MappingIndex, PresetInfo, TargetInfo } from '../models';
import { getDefaultExecutablePath, normalizePath, parseJsonBuffer, toAbsolutePath, uniqueSorted } from '../utils';
import { OutputLogger } from './outputLogger';

interface FileApiIndexObject {
  readonly kind?: string;
  readonly jsonFile?: string;
}

interface FileApiIndex {
  readonly objects?: FileApiIndexObject[];
  readonly reply?: Record<string, FileApiIndexObject> | FileApiIndexObject[];
}

interface FileApiCodemodelTargetRef {
  readonly name?: string;
  readonly id?: string;
  readonly jsonFile?: string;
}

interface FileApiCodemodelConfiguration {
  readonly name?: string;
  readonly targets?: FileApiCodemodelTargetRef[];
}

interface FileApiCodemodel {
  readonly configurations?: FileApiCodemodelConfiguration[];
}

interface FileApiArtifact {
  readonly path?: string;
}

interface FileApiTargetSource {
  readonly path?: string;
  readonly isGenerated?: boolean;
}

interface FileApiTarget {
  readonly name?: string;
  readonly type?: string;
  readonly artifacts?: FileApiArtifact[];
  readonly sources?: FileApiTargetSource[];
}

const SUPPORTED_TARGET_TYPES = new Set([
  'EXECUTABLE',
  'SHARED_LIBRARY',
  'UTILITY',
]);

export class MappingEngine {
  public constructor(private readonly logger: OutputLogger) {}

  private currentIndex: MappingIndex = {
    targets: new Map<string, TargetInfo>(),
    sourceToTargets: new Map<string, string[]>(),
  };

  public async rebuild(preset: PresetInfo): Promise<void> {
    try {
      const fileApiIndex = await this.buildIndexFromFileApi(preset);
      if (fileApiIndex.targets.size > 0) {
        this.logger.info(`Mapping rebuilt from CMake File API with ${fileApiIndex.targets.size} executable target(s)`);
        this.currentIndex = fileApiIndex;
        return;
      }
      this.logger.warn(`CMake File API returned no executable targets for preset ${preset.name}, falling back to compile_commands.json`);
    } catch (error) {
      this.logger.warn(`Failed to rebuild mapping from CMake File API for preset ${preset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public getTargets(): TargetInfo[] {
    return Array.from(this.currentIndex.targets.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public findTargetsBySource(sourcePath: string): TargetInfo[] {
    const targetIds = this.currentIndex.sourceToTargets.get(normalizePath(sourcePath)) ?? [];
    return targetIds
      .map((targetId) => this.currentIndex.targets.get(targetId))
      .filter((target): target is TargetInfo => !!target);
  }

  private async buildIndexFromFileApi(preset: PresetInfo): Promise<MappingIndex> {
    // const cachePath = vscode.Uri.file(path.join(preset.binaryDir, 'CMakeCache.txt'));
    // await vscode.workspace.fs.stat(cachePath);

    const replyDir = vscode.Uri.file(path.join(preset.binaryDir, '.cmake', 'api', 'v1', 'reply'));
    const directoryEntries = await vscode.workspace.fs.readDirectory(replyDir);
    const indexFileNames = directoryEntries
      .filter(([name, type]) => type === vscode.FileType.File && /^index-.*\.json$/i.test(name))
      .map(([name]) => name)
      .sort((left, right) => right.localeCompare(left));

    const latestIndexFileName = indexFileNames[0];
    if (!latestIndexFileName) {
      return this.createEmptyIndex();
    }

    const indexPath = vscode.Uri.file(path.join(replyDir.fsPath, latestIndexFileName));
    const indexContent = await vscode.workspace.fs.readFile(indexPath);
    const parsedIndex = parseJsonBuffer<FileApiIndex>(indexContent).value;
    const replyEntries = Array.isArray(parsedIndex.reply)
      ? parsedIndex.reply
      : Object.values(parsedIndex.reply ?? {});
    const codemodelRef = parsedIndex.objects?.find((entry) => entry.kind === 'codemodel')
      ?? replyEntries.find((entry) => entry.kind === 'codemodel');
    if (!codemodelRef?.jsonFile) {
      return this.createEmptyIndex();
    }

    const codemodelPath = vscode.Uri.file(path.join(replyDir.fsPath, codemodelRef.jsonFile));
    const codemodelContent = await vscode.workspace.fs.readFile(codemodelPath);
    const codemodel = parseJsonBuffer<FileApiCodemodel>(codemodelContent).value;
    const targets = new Map<string, TargetInfo>();
    const sourceToTargets = new Map<string, string[]>();

    const configurations = codemodel.configurations ?? [];
    const hasMultipleConfigurations = configurations.length > 1;

    for (const configuration of configurations) {
      for (const targetRef of configuration.targets ?? []) {
        if (!targetRef.jsonFile) {
          continue;
        }

        const targetPath = vscode.Uri.file(path.join(replyDir.fsPath, targetRef.jsonFile));
        const targetContent = await vscode.workspace.fs.readFile(targetPath);
        const target = parseJsonBuffer<FileApiTarget>(targetContent).value;

        if (!target.name || !target.type || !SUPPORTED_TARGET_TYPES.has(target.type)) {
          continue;
        }

        const executablePath = this.resolveExecutablePath(target, preset);
        const sourceFiles = uniqueSorted(
          (target.sources ?? [])
            .filter((source) => !!source.path && !source.isGenerated)
            .map((source) => toAbsolutePath(source.path as string, preset.sourceDir)),
        );
        const configurationName = configuration.name?.trim();
        const targetDisplayName = hasMultipleConfigurations && configurationName
          ? `${target.name} [${configurationName}]`
          : target.name;
        const targetKey = normalizePath(
          hasMultipleConfigurations && configurationName
            ? `${target.name}::${configurationName}`
            : target.name,
        );

        targets.set(targetKey, {
          id: targetKey,
          name: target.name,
          displayName: targetDisplayName,
          type: target.type,
          configuration: configurationName,
          sourceFiles,
          guessedExecutablePath: executablePath,
        });

        for (const sourceFile of sourceFiles) {
          const sourceKey = normalizePath(sourceFile);
          const mappedTargets = sourceToTargets.get(sourceKey) ?? [];
          if (!mappedTargets.includes(targetKey)) {
            mappedTargets.push(targetKey);
          }
          sourceToTargets.set(sourceKey, mappedTargets);
        }
      }
    }

    return { targets, sourceToTargets };
  }

  private resolveExecutablePath(target: FileApiTarget, preset: PresetInfo): string {
    const artifactPath = target.artifacts?.find((artifact) => !!artifact.path)?.path;
    if (artifactPath) {
      return toAbsolutePath(artifactPath, preset.binaryDir);
    }

    return getDefaultExecutablePath(preset.binaryDir, target.name as string);
  }

  private createEmptyIndex(): MappingIndex {
    return {
      targets: new Map<string, TargetInfo>(),
      sourceToTargets: new Map<string, string[]>(),
    };
  }
}
