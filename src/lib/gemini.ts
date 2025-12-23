import { GoogleGenAI } from '@google/genai';
import { trace, SpanStatusCode, type Context } from '@opentelemetry/api';

const tracer = trace.getTracer('gcg');

const project = process.env.GOOGLE_CLOUD_PROJECT!;
const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const model = process.env.GCG_GEMINI_MODEL || 'gemini-2.5-flash';

const ai = new GoogleGenAI({ vertexai: true, project, location });

export async function generateWithGemini(runCtx: Context, prompt: string): Promise<string> {
    const span = tracer.startSpan('gcg.vertex.generate_content', undefined, runCtx);
    span.setAttribute('gcg.vertex.model', model);
    span.setAttribute('gcg.vertex.location', location);

    try {
        const resp = await ai.models.generateContent({
            model,
            contents: prompt,
        });
        return resp.text ?? '';
    } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
    } finally {
        span.end();
    }
}
