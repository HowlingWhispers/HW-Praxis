// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
const request = { model: 'glm-4-6', messages: [{ role: 'user', content: 'Hello.' }] };

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

  it('lists model ids', async () => {
    const upstream = fakeNovelAI({ body: { data: [{ id: 'glm-4-6' }, { id: 'xialong-v1' }, { name: 'no id' }] } });
    expect(await relayModels(upstream.fetchImpl, token)).toEqual({ status: 200, body: { models: ['glm-4-6', 'xialong-v1'] } });
  });

  it('reports an unreachable NovelAI', async () => {
    const result = await relayChat(async () => { throw new Error('offline'); }, token, request);
    expect(result).toEqual({ status: 502, body: { error: 'Could not reach NovelAI.' } });
  });
});
