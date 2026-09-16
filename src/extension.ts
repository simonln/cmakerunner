import * as vscode from 'vscode';
import { registerPresetCommands } from './app/commands/presetCommands';
import { registerTargetCommands } from './app/commands/targetCommands';
import { CommandContext } from './app/commands/types';
import { registerViewCommands } from './app/commands/viewCommands';
import { SessionLoader } from './app/sessionLoader';
import { SessionStore } from './app/sessionStore';
import { ConfigurationManager } from './services/configurationManager';
import { DebugSessionManager } from './services/debugSessionManager';
import { MappingEngine } from './services/mappingEngine';
import { OutputLogger } from './services/outputLogger';
import { PresetProvider } from './services/presetProvider';
import { TaskExecutionEngine } from './services/taskExecutionEngine';
import { GTestTestController } from './services/testController';
import { WorkflowManager } from './services/workflowManager';
import { PresetsView } from './ui/presetsView';
import { TargetPicker } from './ui/targetPicker';
import { TargetsView } from './ui/targetsView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const outputChannel = vscode.window.createOutputChannel('CMake Runner');
  const logger = new OutputLogger(outputChannel);
  const configurationManager = new ConfigurationManager();
  const store = new SessionStore(context.workspaceState, logger);
  const presetProvider = new PresetProvider(workspaceRoot, logger);
  const mappingEngine = new MappingEngine(logger);
  const sessionLoader = new SessionLoader(store, presetProvider, mappingEngine, logger);
  const taskExecutionEngine = new TaskExecutionEngine(workspaceRoot, logger);
  const debugSessionManager = new DebugSessionManager();
  const testController = new GTestTestController(
    store,
    configurationManager,
    logger,
    debugSessionManager,
    () => sessionLoader.ensureInitialized(),
  );
  const workflowManager = new WorkflowManager(
    configurationManager,
    taskExecutionEngine,
    logger,
    debugSessionManager,
    () => testController.discover(),
  );
  const presetsView = new PresetsView(store);
  const targetsView = new TargetsView(store, workspaceRoot, logger);
  const targetPicker = new TargetPicker(store, logger, workspaceRoot);

  const commandContext: CommandContext = {
    store,
    sessionLoader,
    workflowManager,
    testController,
    presetsView,
    targetsView,
    targetPicker,
    logger,
  };

  logger.info(`Extension activated for workspace: ${workspaceRoot}`);

  context.subscriptions.push(
    outputChannel,
    store,
    presetsView,
    targetsView,
    testController,
    debugSessionManager,
    ...registerViewCommands(commandContext),
    ...registerPresetCommands(commandContext),
    ...registerTargetCommands(commandContext),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      store.setActiveSourcePath(getActiveEditorFilePath(editor));
    }),
  );

  store.setActiveSourcePath(getActiveEditorFilePath(vscode.window.activeTextEditor));

  const initializeOnVisibleView = async (): Promise<void> => {
    await sessionLoader.ensureInitialized();
  };

  const presetsVisibility = presetsView.onDidChangeVisibility(() => {
    if (presetsView.visible) {
      void initializeOnVisibleView();
    }
  });
  if (presetsVisibility) {
    context.subscriptions.push(presetsVisibility);
  }

  const targetsVisibility = targetsView.onDidChangeVisibility(() => {
    if (targetsView.visible) {
      void initializeOnVisibleView();
    }
  });
  if (targetsVisibility) {
    context.subscriptions.push(targetsVisibility);
  }

  if (presetsView.visible || targetsView.visible) {
    void initializeOnVisibleView();
  }
}

function getActiveEditorFilePath(editor: vscode.TextEditor | undefined): string | undefined {
  const documentUri = editor?.document.uri;
  return documentUri?.scheme === 'file' ? documentUri.fsPath : undefined;
}

export function deactivate(): void {
  // no-op
}
