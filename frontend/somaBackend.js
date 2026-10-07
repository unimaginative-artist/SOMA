// somaBackend.js - Re-exports the canonical SomaBackend from apps/command-bridge
// This ensures all imports resolve to the same singleton with dynamic URL configuration
export { default } from './apps/command-bridge/somaBackend.js';
