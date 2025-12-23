import { diag, DiagConsoleLogger, DiagLogLevel, metrics as apiMetrics } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';

import {
    AggregationTemporality,
    MeterProvider,
    PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';

import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

declare global {
    // eslint-disable-next-line no-var
    var __gcgOtelInitialized: boolean | undefined;
}

function parseAttrs(v?: string) {
    const out: Record<string, string> = {};
    if (!v) return out;
    for (const raw of v.split(',')) {
        const s = raw.trim();
        if (!s) continue;
        const idx = s.includes('=') ? s.indexOf('=') : s.indexOf(':');
        if (idx === -1) continue;
        out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
    }
    return out;
}

export async function register() {
    if (globalThis.__gcgOtelInitialized) return;
    globalThis.__gcgOtelInitialized = true;

    if (process.env.OTEL_DIAGNOSTIC_LOG_LEVEL) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    }

    const ddApiKey = process.env.DD_API_KEY;
    const headers: Record<string, string> | undefined = ddApiKey
        ? { 'dd-api-key': ddApiKey }
        : undefined;

    const serviceName = process.env.OTEL_SERVICE_NAME || 'gemini-cost-guardian';
    const attrs = parseAttrs(process.env.OTEL_RESOURCE_ATTRIBUTES);
    const serviceVersion = attrs['service.version'] || '0.1.0';
    const environment = attrs['deployment.environment'] || 'dev';

    const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: serviceVersion,
        'deployment.environment': environment,
    });

    const tracesEndpoint =
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
        'https://otlp.us5.datadoghq.com/v1/traces';
    const metricsEndpoint =
        process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
        'https://otlp.us5.datadoghq.com/v1/metrics';

    // Traces
    const traceExporter = new OTLPTraceExporter({
        url: tracesEndpoint,
        headers,
    });

    const tracerProvider = new NodeTracerProvider({
        resource,
        spanProcessors: [new BatchSpanProcessor(traceExporter)],
    });

    tracerProvider.register();

    // Metrics (delta)
    const metricReader = new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
            url: metricsEndpoint,
            headers,
            temporalityPreference: AggregationTemporality.DELTA,
        }),
        exportIntervalMillis: 10_000,
    });

    const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
    apiMetrics.setGlobalMeterProvider(meterProvider);

    registerInstrumentations({
        tracerProvider,
        meterProvider,
        instrumentations: [getNodeAutoInstrumentations()],
    });

    console.log('[OTel] initialized', { serviceName, serviceVersion, environment });

    process.on('SIGTERM', async () => {
        await Promise.allSettled([meterProvider.shutdown(), tracerProvider.shutdown()]);
    });
}
