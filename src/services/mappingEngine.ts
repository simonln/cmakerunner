import * as path from 'path';
import * as vscode from 'vscode';
import { MappingIndex, PresetInfo, TargetInfo } from '../models';
import { basenameWithoutExecutableExtension, getDefaultExecutablePath, normalizePath, toAbsolutePath, uniqueSorted } from '../utils';
import { OutputLogger } from './outputLogger';

interface CompileCommandEntry {
  readonly directory?: string;
  readonly file?: string;
  readonly command?: string;
  readonly arguments?: string[];
  readonly output?: string;
}

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

export class MappingEngine {
  public constructor(private readonly logger: OutputLogger) {}

  private currentIndex: MappingIndex = {
    targets: new Map<string, TargetInfo>(),
    sourceToTargets: new Map<string, string[]>(),
  };

  public async rebuild(preset: PresetInfo): Promise<void> {
    this.logger.info(`Rebuilding source-to-target mapping for preset ${preset.name}`);
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

    this.currentIndex = await this.buildIndexFromCompileCommands(preset);
    this.logger.info(`Mapping rebuilt from compile_commands.json with ${this.currentIndex.targets.size} executable target(s)`);
  }

  private async buildIndexFromCompileCommands(preset: PresetInfo): Promise<MappingIndex> {
    const compileCommandsPath = vscode.Uri.file(path.join(preset.binaryDir, 'compile_commands.json'));
    let content: Uint8Array;

    this.logger.info(`Reading compile_commands.json from ${compileCommandsPath.fsPath}`);

    try {
      content = await vscode.workspace.fs.readFile(compileCommandsPath);
    } catch (error) {
      this.logger.warn(`Unable to read compile_commands.json from ${compileCommandsPath.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
      return this.createEmptyIndex();
    }

    const entries = JSON.parse(Buffer.from(content).toString('utf8')) as CompileCommandEntry[];
    const targets = new Map<string, TargetInfo>();
    const sourceToTargets = new Map<string, string[]>();

    for (const entry of entries) {
      if (!entry.file) {
        continue;
      }

      const baseDir = entry.directory ? toAbsolutePath(entry.directory, preset.binaryDir) : preset.binaryDir;
      const absoluteSourcePath = toAbsolutePath(entry.file, baseDir);
      const targetName = this.inferTargetName(entry, baseDir);

      if (!targetName) {
        continue;
      }

      const targetKey = normalizePath(targetName);
      const existingTarget = targets.get(targetKey);
      const sourceFiles = existingTarget?.sourceFiles ?? [];
      sourceFiles.push(absoluteSourcePath);

      targets.set(targetKey, {
        id: targetKey,
        name: targetName,
        displayName: targetName,
        sourceFiles: uniqueSorted(sourceFiles),
        guessedExecutablePath: getDefaultExecutablePath(preset.binaryDir, targetName),
      });

      const sourceKey = normalizePath(absoluteSourcePath);
      const mappedTargets = sourceToTargets.get(sourceKey) ?? [];
      if (!mappedTargets.includes(targetKey)) {
        mappedTargets.push(targetKey);
      }
      sourceToTargets.set(sourceKey, mappedTargets);
    }

    this.logger.info(`Parsed compile_commands.json with ${entries.length} compile command entr${entries.length === 1 ? 'y' : 'ies'}`);
    return { targets, sourceToTargets };
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
    const parsedIndex = JSON.parse(Buffer.from(indexContent).toString('utf8')) as FileApiIndex;
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
    const codemodel = JSON.parse(Buffer.from(codemodelContent).toString('utf8')) as FileApiCodemodel;
    const targets = new Map<string, TargetInfo>();
    const sourceToTargets = new Map<string, string[]>();
    // this.logger.info(`Reading CMake File API index ${indexPath.fsPath}`);
    // this.logger.info(`Reading CMake File API codemodel ${codemodelPath.fsPath}`);

    for (const configuration of codemodel.configurations ?? []) {
      for (const targetRef of configuration.targets ?? []) {
        if (!targetRef.jsonFile) {
          continue;
        }

        const targetPath = vscode.Uri.file(path.join(replyDir.fsPath, targetRef.jsonFile));
        const targetContent = await vscode.workspace.fs.readFile(targetPath);
        const target = JSON.parse(Buffer.from(targetContent).toString('utf8')) as FileApiTarget;

        if (target.type !== 'EXECUTABLE' || !target.name) {
          continue;
        }

        const executablePath = this.resolveExecutablePath(target, preset);
        const sourceFiles = uniqueSorted(
          (target.sources ?? [])
            .filter((source) => !!source.path && !source.isGenerated)
            .map((source) => toAbsolutePath(source.path as string, preset.sourceDir)),
        );
        const targetKey = normalizePath(target.name);

        targets.set(targetKey, {
          id: targetKey,
          name: target.name,
          displayName: target.name,
          sourceFiles,
          guessedExecutablePath: executablePath,
        });

        // this.logger.info(`Mapped executable target ${target.name} with ${sourceFiles.length} source file(s)`);

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

  private inferTargetName(entry: CompileCommandEntry, baseDir: string): string | undefined {
    const outputCandidate = entry.output
      ? toAbsolutePath(entry.output, baseDir)
      : this.extractOutputFromArguments(entry.arguments, baseDir) ?? this.extractOutputFromCommand(entry.command, baseDir);

    if (!outputCandidate) {
      return undefined;
    }

    const normalizedOutput = path.normalize(outputCandidate);
    const cmakeMatch = normalizedOutput.match(/[\\/]CMakeFiles[\\/](.+?)\.dir(?:[\\/]|$)/i);
    if (cmakeMatch?.[1]) {
      return basenameWithoutExecutableExtension(cmakeMatch[1]);
    }

    const parsed = path.parse(normalizedOutput);
    return parsed.name || parsed.base;
  }

  private extractOutputFromArguments(argumentsList: string[] | undefined, baseDir: string): string | undefined {
    if (!Array.isArray(argumentsList)) {
      return undefined;
    }

    const outputIndex = argumentsList.findIndex((item) => item === '-o' || item === '/Fo');
    if (outputIndex >= 0 && argumentsList[outputIndex + 1]) {
      return toAbsolutePath(argumentsList[outputIndex + 1], baseDir);
    }

    const joinedOutput = argumentsList.find((item) => item.startsWith('/Fo'));
    if (joinedOutput) {
      return toAbsolutePath(joinedOutput.slice(3), baseDir);
    }

    return undefined;
  }

  private extractOutputFromCommand(command: string | undefined, baseDir: string): string | undefined {
    if (!command) {
      return undefined;
    }

    const outputMatch = command.match(/(?:^|\s)-o\s+("[^"]+"|\S+)/);
    if (outputMatch?.[1]) {
      return toAbsolutePath(outputMatch[1].replace(/^"|"$/g, ''), baseDir);
    }

    const msvcMatch = command.match(/\/Fo("[^"]+"|\S+)/);
    if (msvcMatch?.[1]) {
      return toAbsolutePath(msvcMatch[1].replace(/^"|"$/g, ''), baseDir);
    }

    return undefined;
  }
}
