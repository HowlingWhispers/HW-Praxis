// Relays narration requests to NovelAI's OpenAI-compatible text API.
//
// The player's key arrives with each request and goes straight to NovelAI. It is never
// stored, never logged and never echoed back, and there is no server-side key to fall back
// on, so the relay can only spend the account of whoever is calling it. Only two paths are
// forwarded and every body is validated first.
//
// This lives until Orbis's generation gateway can carry Praxis; see the charter.

import { z } from 'zod';

export const NOVELAI_TEXT_BASE = 'https://text.novelai.net';

export const chatRequestSchema = z.object({
  model: z.string().trim().min(1).max(100),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(200_000),
  })).min(1).max(500),
  max_tokens: z.number().int().min(16).max(2048).default(500),
  temperature: z.number().min(0).max(2).default(0.8),
}).strict();

export interface RelayResult {
  status: number;
  body: unknown;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function cleanToken(raw: string | undefined): string | null {
  const token = (raw ?? '').trim().replace(/^Bearer\s+/i, '');
  return token.length >= 8 && token.length <= 4096 && !/\s/.test(token) ? token : null;
}

const missingToken: RelayResult = { status: 401, body: { error: 'Connect NovelAI with your Persistent API Token first.' } };

async function upstreamError(response: Response): Promise<RelayResult> {
  let message = '';
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      message = typeof parsed.message === 'string' ? parsed.message : typeof parsed.error === 'string' ? parsed.error : '';
    } catch {
      message = text.slice(0, 300);
    }
  } catch {
    // The status alone still says enough.
  }
  const status = [400, 401, 402, 403, 404, 429].includes(response.status) ? response.status : 502;
  const fallback = status === 401 ? 'NovelAI did not accept that token.' : status === 429 ? 'NovelAI is rate limiting requests; wait a moment.' : 'NovelAI could not complete the request.';
  return { status, body: { error: message.trim() || fallback } };
}

export async function relayModels(fetchImpl: Fetch, rawToken: string | undefined): Promise<RelayResult> {
  const token = cleanToken(rawToken);
  if (!token) return missingToken;
  let response: Response;
  try {
    response = await fetchImpl(`${NOVELAI_TEXT_BASE}/oa/v1/models`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { status: 502, body: { error: 'Could not reach NovelAI.' } };
  }
  if (!response.ok) return upstreamError(response);
  const body = await response.json().catch(() => null) as { data?: unknown } | null;
  const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
  const models = data
    .map((entry) => (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : null))
    .filter((entry): entry is string => Boolean(entry));
  return { status: 200, body: { models } };
}

export async function relayChat(fetchImpl: Fetch, rawToken: string | undefined, raw: unknown): Promise<RelayResult> {
  const token = cleanToken(rawToken);
  if (!token) return missingToken;
  const parsed = chatRequestSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: `Invalid narration request: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.` } };

  let response: Response;
  try {
    response = await fetchImpl(`${NOVELAI_TEXT_BASE}/oa/v1/chat/completions`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...parsed.data, stream: false }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { status: 502, body: { error: 'Could not reach NovelAI.' } };
  }
  if (!response.ok) return upstreamError(response);

  const body = await response.json().catch(() => null) as {
    model?: unknown;
    usage?: unknown;
    choices?: { message?: { content?: unknown; reasoning_content?: unknown }; text?: unknown; parsedContent?: unknown; parsed_content?: unknown; finish_reason?: unknown }[];
  } | null;
  const choice = body?.choices?.[0];
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : typeof choice?.text === 'string' ? choice.text : '';
  if (!content.trim()) {
    // Structural diagnostics only: never log provider text, prompts, tokens or reasoning.
    const nonempty = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
    const usage = body?.usage as Record<string, unknown> | undefined;
    const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    // Fixed field names only; string values are represented by length, never content.
    const shape = (value: unknown): unknown => {
      if (value === null) return 'null';
      if (typeof value === 'string') return { type: 'string', length: value.length };
      if (Array.isArray(value)) return { type: 'array', length: value.length };
      return typeof value;
    };
    const message = choice?.message as Record<string, unknown> | undefined;
    const top = body as Record<string, unknown> | null;
    const choiceRecord = choice as Record<string, unknown> | undefined;
    const fields = ['content', 'text', 'parsedContent', 'parsed_content', 'reasoning', 'reasoning_content', 'output', 'output_text', 'delta', 'tool_calls'];
    const describe = (record: Record<string, unknown> | null | undefined) => Object.fromEntries(fields.map(field => [field, shape(record?.[field])]));
    console.warn('[praxis-novelai] empty-reply', JSON.stringify({
      hasChoice: Boolean(choice),
      hasMessageContent: nonempty(choice?.message?.content),
      hasText: nonempty(choice?.text),
      hasParsedContent: nonempty(choice?.parsedContent),
      hasParsedContentSnake: nonempty(choice?.parsed_content),
      hasReasoningContent: nonempty(choice?.message?.reasoning_content),
      finishReason: ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(String(choice?.finish_reason)) ? choice?.finish_reason : 'unknown',
      promptTokens: count(usage?.prompt_tokens),
      completionTokens: count(usage?.completion_tokens),
      requestedMaxTokens: parsed.data.max_tokens,
      responseFields: describe(top),
      choiceFields: describe(choiceRecord),
      messageFields: describe(message),
    }));
    return { status: 502, body: { error: 'NovelAI returned an empty reply.' } };
  }
  return {
    status: 200,
    body: {
      text: content,
      model: typeof body?.model === 'string' ? body.model : parsed.data.model,
      // Passed through for the generation test: prompt and completion sizes, and any cache count.
      usage: body?.usage && typeof body.usage === 'object' ? body.usage : null,
    },
  };
}
