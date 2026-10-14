// The browser side of narration. Requests go to the Praxis server's relay with the player's
// key in a header; the key is kept in memory, and in this browser's storage only when the
// player ticks "Remember on this device".
import type { ChatMessage } from '../engine';

const TOKEN_KEY = 'praxis.novelai.token';
const MODEL_KEY = 'praxis.novelai.model';
export const DEFAULT_MODEL = 'glm-4-6';

let memoryToken = '';

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function rememberedToken(): string {
  try { return storage()?.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function currentToken(): string {
  return memoryToken || rememberedToken();
}

export function setToken(token: string, remember: boolean) {
  memoryToken = token.trim();
  try {
    if (remember && memoryToken) storage()?.setItem(TOKEN_KEY, memoryToken);
    else storage()?.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be blocked; the key still works for this page.
  }
}

export function forgetToken() {
  memoryToken = '';
  try { storage()?.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
}

export function savedModel(): string {
  try { return storage()?.getItem(MODEL_KEY) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}

export function saveModel(model: string) {
  try { storage()?.setItem(MODEL_KEY, model); } catch { /* not remembered */ }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = currentToken();
  if (!token) throw new Error('Connect NovelAI first.');
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-NovelAI-Token': token },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Narration failed (${response.status}).`);
  return body as T;
}

export async function listModels(): Promise<string[]> {
  const body = await call<{ models: string[] }>('/api/novelai/models');
  return body.models;
}

export interface Narration {
  text: string;
  model: string;
  usage: Record<string, unknown> | null;
}

export function narrate(messages: ChatMessage[], model: string, signal?: AbortSignal): Promise<Narration> {
  return call<Narration>('/api/novelai/chat', {
    method: 'POST',
    body: JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.8 }),
    signal,
  });
}
