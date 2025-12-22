import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

let sdkInitialized = false;

function parseAttrs(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

export async function register() {
  if (sdkInitialized) return;

  const DD_API_KEY = process.env.DD_API_KEY;
  if (!DD_API_KEY) {
    console.error('[OTel] Missing DD_API_KEY');
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'gemini-cost-guardian';
  const attrs = parseAttrs(process.env.OTEL_RESOURCE_ATTRIBUTES);
  const serviceVersion = attrs['service.version'] || '0.1.0';
  const environment = attrs['deployment.environment'] || 'dev';

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    'deployment.environment': environment,
  });

  const traceExporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    headers: { 'dd-api-key': DD_API_KEY },
  });

  const metricExporter = new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    headers: {
      'dd-api-key': DD_API_KEY,
      'dd-otel-metric-config': JSON.stringify({
        resource_attributes_as_tags: true,
        instrumentation_scope_metadata_as_tags: true,
        histograms: { mode: 'distributions', send_aggregation_metrics: true },
      }),
    },
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 5000,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
  });

  await sdk.start();
  sdkInitialized = true;
  console.log(`[OTel] initialized service=${serviceName} version=${serviceVersion} env=${environment}`);

  process.on('SIGTERM', async () => {
    try {
      await sdk.shutdown();
    } catch {}
  });
}
