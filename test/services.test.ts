import * as assert from 'assert';
import * as vscode from 'vscode';
import { OutputLogger } from '../src/services/outputLogger';
import { ConfigurationManager } from '../src/services/configurationManager';

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
        has: (_key: string): boolean => config.size > 0,
        update: async (): Promise<void> => {},
        inspect: () => ({ key: '', defaultValue: undefined, globalValue: undefined, workspaceValue: undefined }),
      } as unknown as vscode.WorkspaceConfiguration;
    };

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

    it('should get build command with all variables', () => {
      const mockConfig = createMockConfig({
        'tasks.buildCommandTemplate': 'cmake --build ${buildDir}${configurationArgument} --target ${target}',
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

      assert.strictEqual(result, 'cmake --build /build/debug --config Debug --target myapp');

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

    it('should check clear terminal setting', () => {
      const mockConfig = createMockConfig({
        'tasks.clearTerminalBeforeRun': true,
      });

      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = () => mockConfig;

      const manager = new ConfigurationManager();
      const result = manager.shouldClearTerminalBeforeRun();

      assert.strictEqual(result, true);

      vscode.workspace.getConfiguration = originalGetConfig;
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

      assert.strictEqual(result, require('path').join('/build/debug', 'myapp.exe'));

      vscode.workspace.getConfiguration = originalGetConfig;
    });
  });
});
