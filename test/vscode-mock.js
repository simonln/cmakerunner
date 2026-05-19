const Module = require('module');
const fs = require('fs');
const path = require('path');
const projectRoot = process.cwd();
const registeredCommands = new Map();
const createdTreeViews = new Map();

function resetMockState() {
  registeredCommands.clear();
  createdTreeViews.clear();
  vscode.window.activeTextEditor = undefined;
}

const vscode = {
  workspace: {
    getConfiguration: (section = '') => ({
      get: (key, defaultValue) => {
        const defaults = {
          'tasks.presetConfigureCommandTemplate': 'cmake --preset ${preset}',
          'tasks.buildCommandTemplate': 'cmake --build ${buildDir}${configurationArgument} --target ${target}',
          'tasks.runCommandTemplate': '${executableCommand}',
          'tasks.clearTerminalBeforeRun': true
        };
        return defaults[key] ?? defaultValue;
      },
      has: () => true,
      update: async () => {},
      inspect: (key) => ({ key, defaultValue: undefined, globalValue: undefined, workspaceValue: undefined }),
    }),
    workspaceFolders: [{ uri: { fsPath: projectRoot } }],
    openTextDocument: async (uri) => ({ uri }),
    fs: {
      readFile: async (uri) => fs.promises.readFile(uri.fsPath),
      readDirectory: async (uri) => {
        const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
        return entries.map((entry) => [
          entry.name,
          entry.isDirectory() ? 2 : entry.isFile() ? 1 : 0,
        ]);
      },
      createDirectory: async (uri) => {
        await fs.promises.mkdir(uri.fsPath, { recursive: true });
      },
      writeFile: async (uri, content) => {
        await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
        await fs.promises.writeFile(uri.fsPath, Buffer.from(content));
      },
      stat: async (uri) => {
        const stats = await fs.promises.stat(uri.fsPath);
        return {
          ctime: stats.ctimeMs,
          mtime: stats.mtimeMs,
          size: stats.size,
          type: stats.isDirectory() ? 2 : 1,
        };
      },
    },
  },

  window: {
    createOutputChannel: (name) => ({
      name, append: () => {}, appendLine: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
    }),
    createTreeView: (id, options) => {
      const view = {
        id,
        options,
        description: undefined,
        message: undefined,
        visible: true,
        onDidChangeSelection: () => ({ dispose: () => {} }),
        reveal: async () => undefined,
        dispose: () => { createdTreeViews.delete(id); },
      };
      createdTreeViews.set(id, view);
      return view;
    },
    showInformationMessage: async (msg) => undefined,
    showWarningMessage: async (msg) => undefined,
    showErrorMessage: async (msg) => undefined,
    showQuickPick: async (items) => items?.[0],
    showInputBox: async () => undefined,
    showTextDocument: async (document) => ({
      document,
      selection: undefined,
      revealRange: () => undefined,
    }),
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  },

  commands: {
    registerCommand: (command, callback) => {
      registeredCommands.set(command, callback);
      return { dispose: () => registeredCommands.delete(command) };
    },
    executeCommand: async (command, ...args) => {
      const callback = registeredCommands.get(command);
      if (callback) {
        return callback(...args);
      }
      return undefined;
    },
  },

  TreeItem: class {
    constructor(label, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
      this.contextValue = '';
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeDataProvider: class {},

  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  Uri: {
    file: (fsPath) => ({ fsPath }),
    parse: (uri) => ({ fsPath: uri }),
    joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath, ...segments) }),
  },

  EventEmitter: class {
    constructor() {
      this.listeners = new Set();
      this.event = (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }
    fire(data) { this.listeners.forEach((listener) => listener(data)); }
    dispose() { }
  },

  debug: {
    startDebugging: async () => false,
  },

  tasks: {
    executeTask: async () => ({}),
    onDidEndTaskProcess: () => ({ dispose: () => {} }),
    onDidEndTask: () => ({ dispose: () => {} }),
    TaskRevealKind: { Never: 1, Always: 2, Silent: 3 },
    TaskPanelKind: { Dedicated: 1, Shared: 2, Silent: 3, NewWindow: 4 },
    TaskGroup: { Build: {}, Clean: {}, Test: {} },
    TaskScope: { Workspace: 2 },
  },
  TaskRevealKind: { Never: 1, Always: 2, Silent: 3 },
  TaskPanelKind: { Dedicated: 1, Shared: 2, Silent: 3, NewWindow: 4 },
  TaskGroup: { Build: {}, Clean: {}, Test: {} },
  TaskScope: { Workspace: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },

  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },

  Range: class {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },

  Selection: class {
    constructor(anchor, active) {
      this.anchor = anchor;
      this.active = active;
      this.start = anchor;
      this.end = active;
    }
  },

  Task: class {
    constructor(definition, scope, name, source, execution, problemMatchers) {
      this.definition = definition;
      this.scope = scope;
      this.name = name;
      this.source = source;
      this.execution = execution;
      this.problemMatchers = problemMatchers;
      this.presentationOptions = undefined;
      this.group = undefined;
    }
  },

  ShellExecution: class {
    constructor(cmd, opts = {}) { this.command = cmd; this.options = opts; }
  },

  ThemeIcon: class {
    constructor(id) { this.id = id; }
  },
  __mock: {
    registeredCommands,
    createdTreeViews,
    reset: resetMockState,
  },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode' || request.startsWith('vscode/')) {
    return originalLoad.call(this, path.join(projectRoot, 'test/vscode-mock.js'), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'vscode' || request.startsWith('vscode/')) {
    return originalResolve.call(Module, path.join(projectRoot, 'test/vscode-mock.js'), parent, isMain, options);
  }
  return originalResolve.call(Module, request, parent, isMain, options);
};

module.exports = vscode;
module.exports.default = vscode;
