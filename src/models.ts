export interface PresetInfo {
  readonly name: string;
  readonly displayName: string;
  readonly binaryDir: string;
  readonly sourceDir: string;
  readonly buildPresetName?: string;
  readonly configuration?: string;
  readonly description?: string;
}

export interface TargetInfo {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly configuration?: string;
  readonly sourceFiles: string[];
  readonly guessedExecutablePath: string;
}

export interface GTestCaseInfo {
  readonly suite: string;
  readonly name: string;
  readonly filter: string;
}

export interface MappingIndex {
  readonly targets: Map<string, TargetInfo>;
  readonly sourceToTargets: Map<string, string[]>;
}

export interface TaskVariables {
  readonly buildDir: string;
  readonly preset: string;
  readonly target: string;
  readonly sourceDir: string;
  readonly buildPreset?: string;
  readonly configuration?: string;
  readonly configurationArgument: string;
  readonly executablePath?: string;
  readonly quotedExecutablePath: string;
  readonly executableCommand: string;
  readonly buildPresetArgument: string;
}

export interface TaskExecutionResult {
  readonly exitCode: number | undefined;
}
