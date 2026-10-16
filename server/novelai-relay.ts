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
  // Reasoning models (GLM-4.6) spend part of this thinking before they answer, so it is generous.
  max_tokens: z.number().int().min(16).max(8192).default(2048),
  temperature: z.number().min(0).max(2).default(0.8),
  // 'chat' sends the messages to NovelAI's chat endpoint. 'prompt' formats them into one
  // prompt in GLM's own chat format and sends that to the completions endpoint.
  mode: z.enum(['chat', 'prompt']).default('prompt'),
}).strict();

// GLM-4.x's chat format, with thinking turned off: '/nothink' on the user turns and an
// empty think block where the reply begins.
export function glmPrompt(messages: { role: string; content: string }[]): string {
  let prompt = '[gMASK]<sop>';
  for (const message of messages) {
    if (message.role === 'system') prompt += `<|system|>\n${message.content}`;
    else if (message.role === 'user') prompt += `<|user|>\n${message.content}${message.content.trimEnd().endsWith('/nothink') ? '' : '/nothink'}`;
    else prompt += `<|assistant|>\n<think></think>\n${message.content}`;
  }
  return `${prompt}<|assistant|>\n<think></think>\n`;
}

export const GLM_STOPS = ['<|user|>', '<|observation|>', '<|system|>', '<|endoftext|>'];

// The first choice as a readable record: long token lists become a count, logprobs are dropped.
function describeChoice(choice: unknown): string {
  if (!choice || typeof choice !== 'object') return JSON.stringify(choice ?? null);
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(choice as Record<string, unknown>)) {
    if (key === 'logprobs') continue;
    copy[key] = Array.isArray(value) && value.length > 8 ? `[${value.length} items: ${value.slice(0, 8).join(', ')}, ...]` : value;
  }
  return JSON.stringify(copy).slice(0, 1500);
}

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
  let raw = '';
  try {
    const text = await response.text();
    raw = text.slice(0, 600);
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
  return { status, body: { error: message.trim() || fallback, diagnostics: { status: response.status, upstreamBody: raw } } };
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
  const { mode, messages, ...settings } = parsed.data;

  const endpoint = mode === 'chat' ? '/oa/v1/chat/completions' : '/oa/v1/completions';
  const upstreamBody = mode === 'chat'
    ? { ...settings, messages, stream: false }
    : { ...settings, prompt: glmPrompt(messages), stop: GLM_STOPS, stream: false };

  // How long NovelAI took, measured here so the browser's own distance to this server does
  // not count. The generation test compares these.
  const started = performance.now();
  const upstreamMs = () => Math.round(performance.now() - started);
  let response: Response;
  try {
    response = await fetchImpl(`${NOVELAI_TEXT_BASE}${endpoint}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { status: 502, body: { error: 'Could not reach NovelAI.', diagnostics: { endpoint, mode, upstreamMs: upstreamMs() } } };
  }
  if (!response.ok) {
    const failed = await upstreamError(response);
    const body = failed.body as { error: string; diagnostics?: Record<string, unknown> };
    return { status: failed.status, body: { ...body, diagnostics: { ...body.diagnostics, endpoint, mode, upstreamMs: upstreamMs() } } };
  }

  const body = await response.json().catch(() => null) as {
    model?: unknown;
    usage?: unknown;
    choices?: {
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      text?: unknown;
      parsedContent?: unknown;
      parsed_content?: unknown;
      finish_reason?: unknown;
    }[];
  } | null;
  const elapsed = upstreamMs();
  const choice = body?.choices?.[0];
  const firstText = (...values: unknown[]) => (values.find((value) => typeof value === 'string' && value.trim()) as string | undefined) ?? '';
  const content = firstText(choice?.message?.content, choice?.text, choice?.parsedContent, choice?.parsed_content);
  const reasoningRaw = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
  const reasoning = typeof reasoningRaw === 'string' ? reasoningRaw : '';
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  // What the interface's diagnostics panel shows the player who made the request. Never includes the token.
  const diagnostics = {
    endpoint,
    mode,
    status: response.status,
    model: typeof body?.model === 'string' ? body.model : settings.model,
    finishReason,
    contentLength: content.length,
    reasoningLength: reasoning.length,
    reasoningPreview: reasoning.slice(0, 600),
    choiceFields: choice ? Object.keys(choice).concat(choice.message ? Object.keys(choice.message).map((key) => `message.${key}`) : []) : [],
    textType: choice && 'text' in choice ? (choice.text === null ? 'null' : typeof choice.text) : 'absent',
    rawChoice: describeChoice(choice),
    maxTokens: settings.max_tokens,
    upstreamMs: elapsed,
    usage: body?.usage && typeof body.usage === 'object' ? body.usage : null,
  };
  if (!content) {
    logEmptyReply(body, choice, settings.max_tokens, endpoint);
    const why = reasoning && finishReason === 'length'
      ? `The model used its whole allowance (${settings.max_tokens} tokens) thinking and wrote no reply.`
      : body === null ? 'NovelAI sent something that was not JSON.' : 'NovelAI returned an empty reply.';
    return { status: 502, body: { error: why, diagnostics } };
  }
  return { status: 200, body: { text: content, model: diagnostics.model, usage: diagnostics.usage, diagnostics } };
}

// Server log for an empty reply. Structure only: never provider text, prompts, tokens or reasoning.
function logEmptyReply(body: unknown, rawChoice: unknown, requestedMaxTokens: number, endpoint: string) {
  const top = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  const choice = rawChoice && typeof rawChoice === 'object' ? rawChoice as Record<string, unknown> : undefined;
  const message = choice?.message && typeof choice.message === 'object' ? choice.message as Record<string, unknown> : undefined;
  const nonempty = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
  const usage = top?.usage as Record<string, unknown> | undefined;
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  // Fixed field names only; string values are represented by length, never content.
  const shape = (value: unknown): unknown => {
    if (value === null) return 'null';
    if (typeof value === 'string') return { type: 'string', length: value.length };
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    return typeof value;
  };
  const fields = ['content', 'text', 'parsedContent', 'parsed_content', 'reasoning', 'reasoning_content', 'output', 'output_text', 'delta', 'tool_calls', 'token_ids'];
  const describe = (record: Record<string, unknown> | null | undefined) => Object.fromEntries(fields.map((field) => [field, shape(record?.[field])]));
  console.warn('[praxis-novelai] empty-reply', JSON.stringify({
    endpoint,
    hasChoice: Boolean(choice),
    hasMessageContent: nonempty(message?.content),
    hasText: nonempty(choice?.text),
    hasParsedContent: nonempty(choice?.parsedContent),
    hasParsedContentSnake: nonempty(choice?.parsed_content),
    hasReasoningContent: nonempty(message?.reasoning_content),
    finishReason: ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(String(choice?.finish_reason)) ? choice?.finish_reason : 'unknown',
    promptTokens: count(usage?.prompt_tokens),
    completionTokens: count(usage?.completion_tokens),
    requestedMaxTokens,
    responseFields: describe(top),
    choiceFields: describe(choice),
    messageFields: describe(message),
  }));
}
