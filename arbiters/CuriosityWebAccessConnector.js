/**
 * ES Module wrapper for CuriosityWebAccessConnector
 * Allows ES6 imports while using CommonJS implementation
 */

import CuriosityWebAccessConnectorModule from './CuriosityWebAccessConnector.cjs';

export const CuriosityWebAccessConnector = CuriosityWebAccessConnectorModule.CuriosityWebAccessConnector;
export default CuriosityWebAccessConnectorModule.CuriosityWebAccessConnector;
