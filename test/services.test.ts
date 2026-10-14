import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { OutputLogger } from '../src/services/outputLogger';
import { ConfigurationManager } from '../src/services/configurationManager';
import { clearPresetBuildDirectory } from '../src/services/buildDirectoryCleaner';
import { PresetInfo } from '../src/models';

if (typeof vscode === 'undefined' || !vscode.workspace) {
  throw new Error('vscode not available - run tests in VS Code Extension Host');
}

describe('services', () => {
  describe('OutputLogger', () => {
    it('should create output logger', () => {
      const channel: vscode.OutputChannel = {
        name: 'test',
        append: () => {},
        appendLine: (line: string) => {
          // captured
        },
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      } as unknown as vscode.OutputChannel;

      const logger = new OutputLogger(channel);
      assert.ok(logger);
    });

it('should call appendLine for info level', () => {
      let lastLine = '';
      const channel: vscode.OutputChannel = {
        name: 'test',
        append: () => {},
        appendLine: (line: string) => { lastLine = line; },
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      } as unknown as vscode.OutputChannel;

      const logger = new OutputLogger(channel);
      logger.info('test message');
      assert.ok(lastLine.includes('[INFO]'));
      assert.ok(lastLine.includes('test message'));
    });

    it('should call appendLine for warn level', () => {
      let lastLine = '';
      const channel: vscode.OutputChannel = {
        name: 'test',
        append: () => {},
        appendLine: (line: string) => {
          lastLine = line;
        },
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      } as unknown as vscode.OutputChannel;

      const logger = new OutputLogger(channel);
      logger.warn('warning message');
      assert.ok(lastLine.includes('[WARN]'));
    });

    it('should call appendLine for error level', () => {
      let lastLine = '';
      const channel: vscode.OutputChannel = {
        name: 'test',
        append: () => {},
        appendLine: (line: string) => {
          lastLine = line;
        },
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      } as unknown as vscode.OutputChannel;

      const logger = new OutputLogger(channel);
      logger.error('error message');
      assert.ok(lastLine.includes('[ERROR]'));
    });
  });

  describe('ConfigurationManager', () => {
    const createMockConfig = (settings: Record<string, unknown>): vscode.WorkspaceConfiguration => {
      const config = new Map(Object.entries(settings));
      return {
        get: <T>(key: string, defaultValue?: T): T => {
          const value = config.get(key);
          return (value !== undefined ? value : defaultValue) as T;
        },
        has: (key: string): boolean => config.has(key),
        update: async (): Promise<void> => {},
        inspect: (key: string) => ({
          key,
          defaultValue: undefined,
          globalValue: config.get(key),
          workspaceValue: undefined,
          workspaceFolderValue: undefined,
        }),
      } as unknown as vscode.WorkspaceConfiguration;
    };

    const withMockPlatform = <T>(platform: NodeJS.Platform, run: () => T): T => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        return run();
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(process, 'platform', originalDescriptor);
        }
      }
    };

    it('should default the GoogleTest case timeout to 60 seconds (60000 ms)', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({});

      const manager = new ConfigurationManager();
      assert.strictEqual(manager.getGTestCaseTimeoutMs(), 60000);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should interpret the configured GoogleTest case timeout as seconds', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.caseTimeoutSeconds': 5 });

      const manager = new ConfigurationManager();
      assert.strictEqual(manager.getGTestCaseTimeoutMs(), 5000);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should keep a configured zero second timeout to disable the limit', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.caseTimeoutSeconds': 0 });

      const manager = new ConfigurationManager();
      assert.strictEqual(manager.getGTestCaseTimeoutMs(), 0);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should fall back to the legacy millisecond timeout when the seconds setting is absent', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.caseTimeoutMs': 90000 });

      const manager = new ConfigurationManager();
      assert.strictEqual(manager.getGTestCaseTimeoutMs(), 90000);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should prefer the seconds setting over the legacy millisecond timeout', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({
        'gtests.caseTimeoutSeconds': 2,
        'gtests.caseTimeoutMs': 90000,
      });

      const manager = new ConfigurationManager();
      assert.strictEqual(manager.getGTestCaseTimeoutMs(), 2000);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should fall back to 60000 ms for invalid timeout values', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.caseTimeoutSeconds': -5 });

      const manager = new ConfigurationManager();
      assert.strictEqual(manager.getGTestCaseTimeoutMs(), 60000);

      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.caseTimeoutSeconds': Number.NaN });
      assert.strictEqual(new ConfigurationManager().getGTestCaseTimeoutMs(), 60000);

      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.caseTimeoutMs': -5 });
      assert.strictEqual(new ConfigurationManager().getGTestCaseTimeoutMs(), 60000);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should default GoogleTest executable patterns to the test prefix', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({});

      const manager = new ConfigurationManager();
      assert.deepStrictEqual([...manager.getGTestExecutablePatterns()], ['test*']);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should use configured GoogleTest executable patterns', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => createMockConfig({
        'gtests.executablePatterns': ['*_test', ' MathTest '],
      });

      const manager = new ConfigurationManager();
      assert.deepStrictEqual([...manager.getGTestExecutablePatterns()], ['*_test', 'MathTest']);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should fall back to the default pattern for invalid pattern settings', () => {
      const originalGetConfig = vscode.workspace.getConfiguration;

      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.executablePatterns': ['', 42] });
      assert.deepStrictEqual([...new ConfigurationManager().getGTestExecutablePatterns()], ['test*']);

      (vscode.workspace as any).getConfiguration = () => createMockConfig({ 'gtests.executablePatterns': 'test*' });
      assert.deepStrictEqual([...new ConfigurationManager().getGTestExecutablePatterns()], ['test*']);

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should get preset configure command with variables', () => {
      const mockConfig = createMockConfig({
        'tasks.presetConfigureCommandTemplate': 'cmake --preset ${preset} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
      });

      // Mock vscode.workspace.getConfiguration
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.getPresetConfigureCommand({
        buildDir: '/build/debug',
        preset: 'debug',
        sourceDir: '/src',
      });

      assert.strictEqual(result, 'cmake --preset debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON');

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should quote preset name containing spaces in configure command', () => {
      const mockConfig = createMockConfig({
        'tasks.presetConfigureCommandTemplate': 'cmake --preset ${preset}',
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.getPresetConfigureCommand({
        buildDir: 'C:/My Projects/build',
        preset: 'My Preset',
        sourceDir: 'C:/My Projects/src',
      });

      assert.strictEqual(result, 'cmake --preset "My Preset"');

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should get build command with all variables', () => {
      const mockConfig = createMockConfig({
        'tasks.buildCommandTemplate': 'cmake --build ${buildDir} ${configurationArgument} --target ${target}',
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.getBuildCommand({
        buildDir: '/build/debug',
        preset: 'debug',
        target: 'myapp',
        sourceDir: '/src',
        buildPreset: 'debug',
        configuration: 'Debug',
        configurationArgument: ' --config Debug',
        executablePath: '/build/debug/myapp',
        quotedExecutablePath: '"/build/debug/myapp"',
        executableCommand: '"/build/debug/myapp"',
        buildPresetArgument: ' --preset debug',
      });

      assert.strictEqual(result, 'cmake --build /build/debug  --config Debug --target myapp');

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should auto-quote build dir and target containing spaces', () => {
      const mockConfig = createMockConfig({
        'tasks.buildCommandTemplate': 'cmake --build ${buildDir} ${configurationArgument} --target ${target}',
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.getBuildCommand({
        buildDir: 'C:/My Projects/build',
        preset: 'debug',
        target: 'My App',
        sourceDir: 'C:/My Projects/src',
        buildPreset: 'Debug Preset',
        configuration: 'Debug',
        configurationArgument: ' --config Debug',
        executablePath: 'C:/My Projects/build/My App.exe',
        quotedExecutablePath: '"C:/My Projects/build/My App.exe"',
        executableCommand: '"C:/My Projects/build/My App.exe"',
        buildPresetArgument: ' --preset Debug Preset',
      });

      assert.strictEqual(result, 'cmake --build "C:/My Projects/build"  --config Debug --target "My App"');

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should get run command', () => {
      const mockConfig = createMockConfig({
        'tasks.runCommandTemplate': '${executableCommand}',
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.getRunCommand({
        buildDir: '/build/debug',
        preset: 'debug',
        target: 'myapp',
        sourceDir: '/src',
        configurationArgument: '',
        quotedExecutablePath: '"/build/debug/myapp"',
        executableCommand: '"/build/debug/myapp"',
        buildPresetArgument: '',
      });

      assert.strictEqual(result, '"/build/debug/myapp"');

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should create debug configuration from installed Microsoft C++ extension', () => {
      const mockConfig = createMockConfig({
        configurations: [],
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      const originalExtensions = vscode.extensions.all;
      (vscode.workspace as any).getConfiguration = (section?: string) => section === 'launch' ? mockConfig : createMockConfig({});
      Object.defineProperty(vscode.extensions, 'all', { value: [{ id: 'ms-vscode.cpptools' }], configurable: true });

      try {
        withMockPlatform('linux', () => {
          const result = new ConfigurationManager().createDebugConfiguration({
            name: 'Debug Test',
            program: '/build/debug/myapp',
            cwd: '/build/debug',
            args: ['--gtest_filter=Suite.Test'],
          });
          assert.strictEqual(result.type, 'cppdbg');
          assert.strictEqual(result.MIMode, 'gdb');
          assert.strictEqual(result.program, '/build/debug/myapp');
          assert.deepStrictEqual(result.args, ['--gtest_filter=Suite.Test']);
        });
      } finally {
        vscode.workspace.getConfiguration = originalGetConfig;
        Object.defineProperty(vscode.extensions, 'all', { value: originalExtensions, configurable: true });
      }
    });

    it('should prefer compatible launch configuration templates', () => {
      const mockConfig = createMockConfig({
        configurations: [{
          name: 'Existing C++',
          type: 'cppdbg',
          request: 'launch',
          stopAtEntry: true,
        }],
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => section === 'launch' ? mockConfig : createMockConfig({});

      try {
        const result = new ConfigurationManager().createDebugConfiguration({
          name: 'Debug Test',
          program: '/build/debug/myapp',
          cwd: '/build/debug',
          args: [],
        });
        assert.strictEqual(result.type, 'cppdbg');
        assert.strictEqual(result.stopAtEntry, true);
        assert.strictEqual(result.program, '/build/debug/myapp');
      } finally {
        vscode.workspace.getConfiguration = originalGetConfig;
      }
    });

    it('should resolve debug program from run command', () => {
      const mockConfig = createMockConfig({
        'tasks.runCommandTemplate': '${executableCommand}',
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.resolveDebugProgram({
        buildDir: '/build/debug',
        preset: 'debug',
        target: 'myapp',
        sourceDir: '/src',
        configurationArgument: '',
        executablePath: '/build/debug/myapp',
        quotedExecutablePath: '"/build/debug/myapp"',
        executableCommand: '"/build/debug/myapp"',
        buildPresetArgument: '',
      });

      assert.strictEqual(result, '/build/debug/myapp');

      vscode.workspace.getConfiguration = originalGetConfig;
    });

    it('should fall back to default executable path when run command is empty', () => {
      const mockConfig = createMockConfig({
        'tasks.runCommandTemplate': '',
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.resolveDebugProgram({
        buildDir: '/build/debug',
        preset: 'debug',
        target: 'myapp',
        sourceDir: '/src',
        configurationArgument: '',
        quotedExecutablePath: '"/build/debug/myapp"',
        executableCommand: '"/build/debug/myapp"',
        buildPresetArgument: '',
      });

      assert.strictEqual(
        result,
        path.join('/build/debug', process.platform === 'win32' ? 'myapp.exe' : 'myapp'),
      );

      vscode.workspace.getConfiguration = originalGetConfig;
    });
  });

  describe('buildDirectoryCleaner', () => {
    const createPresetInfo = (binaryDir: string): PresetInfo => ({
      name: 'debug',
      displayName: 'Debug',
      binaryDir,
      sourceDir: '/src',
    });

    const createLogger = (): OutputLogger => ({
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as OutputLogger);

    it('removes every build directory entry except compile_commands.json', async () => {
      const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmakerunner-clean-'));
      const compileCommandsFile = path.join(binaryDir, 'compile_commands.json');
      const objectFile = path.join(binaryDir, 'CMakeFiles', 'app.dir', 'main.obj');
      const replyFile = path.join(binaryDir, '.cmake', 'api', 'v1', 'reply', 'index-1.json');
      const arbitraryFile = path.join(binaryDir, 'app.exe');

      try {
        fs.writeFileSync(compileCommandsFile, '[]');
        fs.writeFileSync(path.join(binaryDir, 'CMakeCache.txt'), 'cache');
        fs.mkdirSync(path.dirname(objectFile), { recursive: true });
        fs.writeFileSync(objectFile, 'obj');
        fs.mkdirSync(path.dirname(replyFile), { recursive: true });
        fs.writeFileSync(replyFile, '{}');
        fs.writeFileSync(arbitraryFile, 'bin');

        const cleared = await clearPresetBuildDirectory(createPresetInfo(binaryDir), createLogger());

        assert.strictEqual(cleared, true);
        assert.strictEqual(fs.existsSync(binaryDir), true);
        assert.strictEqual(fs.existsSync(compileCommandsFile), true);
        assert.strictEqual(fs.existsSync(objectFile), false);
        assert.strictEqual(fs.existsSync(path.join(binaryDir, '.cmake')), false);
        assert.strictEqual(fs.existsSync(path.join(binaryDir, 'CMakeCache.txt')), false);
        assert.strictEqual(fs.existsSync(arbitraryFile), false);
      } finally {
        fs.rmSync(binaryDir, { recursive: true, force: true });
      }
    });
  });
});
