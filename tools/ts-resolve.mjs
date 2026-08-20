// Lets plain `node` import the app's TypeScript modules directly.
//
// src/lib/*.ts uses extensionless relative imports (`./tools`) because that is
// what Vite and Astro expect. Node's ESM resolver requires the extension, so
// build-time scripts that want to reuse app code — the OG card generator reads
// the real tool registry — would otherwise have to duplicate it and drift.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to the normal resolution and its error message.
      }
    }
    return nextResolve(specifier, context);
  },
});
