import { OutputLogger } from '../../services/outputLogger';
import { GTestTestController } from '../../services/testController';
import { WorkflowManager } from '../../services/workflowManager';
import { PresetsView } from '../../ui/presetsView';
import { TargetPicker } from '../../ui/targetPicker';
import { TargetsView } from '../../ui/targetsView';
import { SessionLoader } from '../sessionLoader';
import { SessionStore } from '../sessionStore';

export interface CommandContext {
  readonly store: SessionStore;
  readonly sessionLoader: SessionLoader;
  readonly workflowManager: WorkflowManager;
  readonly testController: GTestTestController;
  readonly presetsView: PresetsView;
  readonly targetsView: TargetsView;
  readonly targetPicker: TargetPicker;
  readonly logger: OutputLogger;
}
