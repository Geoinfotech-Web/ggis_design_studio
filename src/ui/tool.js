/** Which left-hand panel is showing. Kept separate so panels can switch
 *  each other without importing the chrome that renders the rail. */

import { set } from '../core/store.js';

export const setTool = (id) => set({ activeTool: id }, { history: false });
