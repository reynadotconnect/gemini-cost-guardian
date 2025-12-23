import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

export async function register() {
    if (process.env.OTEL_DIAGNOSTIC_LOG_LEVEL) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    }

    if (process.env.NEXT_RUNTIME !== 'edge') {
        const mod = await import('./instrumentation.node');
        await mod.register();
    }
}
