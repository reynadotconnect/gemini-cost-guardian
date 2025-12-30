import { GoogleGenAI } from '@google/genai';
import { trace, SpanStatusCode, type Context } from '@opentelemetry/api';

const tracer = trace.getTracer('gcg');

const project = process.env.GOOGLE_CLOUD_PROJECT!;
const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const model = process.env.GCG_GEMINI_MODEL || 'gemini-2.5-flash';

const ai = new GoogleGenAI({ vertexai: true, project, location, apiVersion: 'v1' });

export type GeminiUsage = {
    prompt_tokens: number;
    output_tokens: number;
    total_tokens: number;
};

export type GeminiResult = {
    text: string;
    usage: GeminiUsage;
};

function pickUsage(resp: any): GeminiUsage {
    // REST schema names: promptTokenCount, candidatesTokenCount :contentReference[oaicite:5]{index=5}
    const u =
        resp?.usageMetadata ?? resp?.response?.usageMetadata ?? resp?.raw?.usageMetadata ?? {};

    const prompt = Number(u.promptTokenCount ?? 0);
    const out = Number(u.candidatesTokenCount ?? 0);
    const p = Number.isFinite(prompt) ? prompt : 0;
    const o = Number.isFinite(out) ? out : 0;
    const t = Number(u.totalTokenCount ?? p + o) || p + o; // prefer server total

    return { prompt_tokens: p, output_tokens: o, total_tokens: t };
}

export async function generateWithGemini(
    runCtx: Context,
    prompt: string,
    cfg?: { maxOutputTokens?: number }
): Promise<GeminiResult> {
    const span = tracer.startSpan('gcg.vertex.generate_content', undefined, runCtx);
    span.setAttribute('gcg.vertex.model', model);
    span.setAttribute('gcg.vertex.location', location);

    try {
        const config = {
            thinkingConfig: { thinkingBudget: 0 },
            ...(cfg?.maxOutputTokens != null ? { maxOutputTokens: cfg.maxOutputTokens } : {}),
            temperature: 0,
        };
        const resp = await ai.models.generateContent({
            model,
            contents: prompt,
            config,
        });

        const usage = pickUsage(resp);
        span.setAttribute(
            'gcg.tokens.thoughts',
            Number(resp?.usageMetadata?.thoughtsTokenCount ?? 0)
        );

        span.setAttribute('gcg.tokens.prompt', usage.prompt_tokens);
        span.setAttribute('gcg.tokens.output', usage.output_tokens);
        span.setAttribute('gcg.tokens.total', usage.total_tokens);

        return { text: resp.text ?? '', usage };
    } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
    } finally {
        span.end();
    }
}
