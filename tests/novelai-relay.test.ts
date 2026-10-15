// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { glmPrompt, relayChat, relayModels } from '../server/novelai-relay';
import { describe, expect, it, vi } from 'vitest';
import { relayChat, relayModels } from '../server/novelai-relay';

type Call = { url: string; init?: RequestInit };

function fakeNovelAI(reply: { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const token = 'pst-abcdefghijklmnop';
const request = { model: 'glm-4-6', mode: 'chat', messages: [{ role: 'user', content: 'Hello.' }] };

describe('the NovelAI relay', () => {
  it('forwards a chat with the caller\'s token and returns the text and usage', async () => {
    const upstream = fakeNovelAI({ body: { model: 'glm-4-6', choices: [{ message: { content: '*Rain.*' } }], usage: { prompt_tokens: 12 } } });
    const result = await relayChat(upstream.fetchImpl, token, request);
    expect(result).toMatchObject({ status: 200, body: { text: '*Rain.*', model: 'glm-4-6', usage: { prompt_tokens: 12 } } });
    expect(upstream.calls[0]!.url).toBe('https://text.novelai.net/oa/v1/chat/completions');
    const headers = upstream.calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(upstream.calls[0]!.init!.body))).toMatchObject({ model: 'glm-4-6', max_tokens: 2048, stream: false });
  });

  it('refuses without a token and never calls out', async () => {
    const upstream = fakeNovelAI({ body: {} });
    expect((await relayChat(upstream.fetchImpl, undefined, request)).status).toBe(401);
    expect((await relayModels(upstream.fetchImpl, 'short')).status).toBe(401);
    expect(upstream.calls).toEqual([]);
  });

  it('refuses a malformed body and never calls out', async () => {
    const upstream = fakeNovelAI({ body: {} });
    const result = await relayChat(upstream.fetchImpl, token, { ...request, extra: 'field' });
    expect(result.status).toBe(400);
    expect(upstream.calls).toEqual([]);
  });

  it('passes on NovelAI\'s own refusal without the token', async () => {
    const upstream = fakeNovelAI({ status: 401, body: { message: 'Invalid token' } });
    const result = await relayChat(upstream.fetchImpl, token, request);
    expect(result).toMatchObject({ status: 401, body: { error: 'Invalid token', diagnostics: { status: 401 } } });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('explains a reasoning model that ran out of room before answering', async () => {
    const upstream = fakeNovelAI({ body: { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'Let me think about the gate...' } }] } });
    const result = await relayChat(upstream.fetchImpl, token, request);
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      error: 'The model used its whole allowance (2048 tokens) thinking and wrote no reply.',
      diagnostics: { finishReason: 'length', contentLength: 0, reasoningLength: 30, choiceFields: ['finish_reason', 'message', 'message.content', 'message.reasoning_content'] },
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('reports an empty reply as a failure', async () => {
    const upstream = fakeNovelAI({ body: { choices: [{ message: { content: '  ' } }] } });
    expect((await relayChat(upstream.fetchImpl, token, request)).status).toBe(502);
  });

  it('sends a GLM-formatted prompt to the completions endpoint by default', async () => {
    const upstream = fakeNovelAI({ body: { choices: [{ text: '*Rain.*', finish_reason: 'stop' }] } });
    const result = await relayChat(upstream.fetchImpl, token, { model: 'glm-4-6', messages: [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'Hello.' }] });
    expect(result).toMatchObject({ status: 200, body: { text: '*Rain.*', diagnostics: { endpoint: '/oa/v1/completions', mode: 'prompt' } } });
    expect(upstream.calls[0]!.url).toBe('https://text.novelai.net/oa/v1/completions');
    const sent = JSON.parse(String(upstream.calls[0]!.init!.body));
    expect(sent.prompt).toBe('[gMASK]<sop><|system|>\nRules.<|user|>\nHello./nothink<|assistant|>\n<think></think>\n');
    expect(sent.stop).toContain('<|user|>');
    expect(sent.messages).toBeUndefined();
  });

  it('formats earlier replies as assistant turns', () => {
    expect(glmPrompt([{ role: 'assistant', content: 'Fog.' }, { role: 'user', content: 'Go./nothink' }]))
      .toBe('[gMASK]<sop><|assistant|>\n<think></think>\nFog.<|user|>\nGo./nothink<|assistant|>\n<think></think>\n');
  });

  it('shows the raw choice when text is empty, with token lists shortened', async () => {
    const upstream = fakeNovelAI({ body: { choices: [{ index: 0, text: '', token_ids: Array.from({ length: 20 }, (_, i) => i), finish_reason: 'stop', matched_stop: 151329 }] } });
    const result = await relayChat(upstream.fetchImpl, token, request);
    expect(result.body).toMatchObject({ diagnostics: { textType: 'string', contentLength: 0 } });
    const raw = (result.body as { diagnostics: { rawChoice: string } }).diagnostics.rawChoice;
    expect(raw).toContain('"token_ids":"[20 items: 0, 1, 2, 3, 4, 5, 6, 7, ...]"');
    expect(raw).toContain('151329');
  it('logs only structural metadata for an empty reply', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const upstream = fakeNovelAI({ body: {
        choices: [{ message: { content: '', reasoning_content: 'private reasoning' }, parsedContent: 'private fiction', finish_reason: 'length' }],
        usage: { prompt_tokens: 12, completion_tokens: 500 },
      } });
      expect((await relayChat(upstream.fetchImpl, token, request)).status).toBe(502);
      expect(warning).toHaveBeenCalledOnce();
      const metadata = JSON.parse(warning.mock.calls[0]![1]);
      expect(metadata).toMatchObject({ hasParsedContent: true, hasReasoningContent: true, finishReason: 'length', completionTokens: 500, requestedMaxTokens: 500 });
      const output = JSON.stringify(warning.mock.calls);
      for (const secret of [token, 'private reasoning', 'private fiction', 'Hello.']) expect(output).not.toContain(secret);
    } finally {
      warning.mockRestore();
    }
  });

  it('lists model ids', async () => {
    const upstream = fakeNovelAI({ body: { data: [{ id: 'glm-4-6' }, { id: 'xialong-v1' }, { name: 'no id' }] } });
    expect(await relayModels(upstream.fetchImpl, token)).toEqual({ status: 200, body: { models: ['glm-4-6', 'xialong-v1'] } });
  });

  it('reports an unreachable NovelAI', async () => {
    const result = await relayChat(async () => { throw new Error('offline'); }, token, request);
    expect(result).toMatchObject({ status: 502, body: { error: 'Could not reach NovelAI.' } });
  });
});
