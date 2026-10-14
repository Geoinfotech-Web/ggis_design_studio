/** Which left-hand panel is showing. Kept separate so panels can switch
 *  each other without importing the chrome that renders the rail. */

import { state, set } from '../core/store.js';
import { toolLocked, lockReason } from '../core/flow.js';
import { notify } from '../core/toast.js';

/**
 * Switch panel. A tool that is not open yet says why instead of opening, and
 * sends you to the step that will open it.
 */
export function setTool(id) {
  if (toolLocked(id)) {
    notify.info(lockReason(), { duration: 4200 });
    set({ activeTool: state.studyArea ? 'start' : 'area' }, { history: false });
    return false;
  }
  set({ activeTool: id }, { history: false });
  return true;
}
