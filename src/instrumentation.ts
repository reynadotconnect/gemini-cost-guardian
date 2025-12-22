export async function register() {
  // Next.js recommends runtime-gating instrumentation imports
  // so edge/client bundling never touches Node-only deps.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const mod = await import('./instrumentation.node');
    await mod.register();
  }
}