import { autotelHandle, useLogger } from 'autotel-adapters/sveltekit';

export const handle = autotelHandle({
  enrichRequest: (event) => ({ route: event.url.pathname }),
});

export function exampleUsage() {
  useLogger().set({ demo: true });
}
