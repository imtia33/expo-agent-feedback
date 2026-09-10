/**
 * expo-eyes-app — public API
 *
 * Wrap your app in EyesProvider to give an agent eyes (inspect) and
 * fingers (tap, type, scroll) over a WebSocket to expo-eyes-relay.
 *
 * Example:
 *   import { EyesProvider } from 'expo-eyes-app';
 *
 *   export default function App() {
 *     return (
 *       <EyesProvider
 *         relayUrl="ws://192.168.1.5:8766"
 *         token="your-secret-token"
 *       >
 *         <RealApp />
 *       </EyesProvider>
 *     );
 *   }
 */

export { EyesProvider } from './EyesProvider';
export type { EyesProviderProps } from './EyesProvider';
export type { TreeNode, ToolName } from './protocol';

// Default export for convenience
export { EyesProvider as default } from './EyesProvider';
