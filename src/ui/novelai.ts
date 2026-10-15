// The browser side of narration. Requests go to the Praxis server's relay with the player's
// key in a header; the key is kept in memory, and in this browser's storage only when the
// player ticks "Remember on this device".
import type { ChatMessage } from '../engine';

const TOKEN_KEY = 'praxis.novelai.token';
const MODEL_KEY = 'praxis.novelai.model';
const MODE_KEY = 'praxis.novelai.mode';

// 'prompt': GLM-formatted prompt to the completions endpoint. 'chat': messages to the chat endpoint.
export type NarrationMode = 'prompt' | 'chat';
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

export function savedMode(): NarrationMode {
  try { return storage()?.getItem(MODE_KEY) === 'chat' ? 'chat' : 'prompt'; } catch { return 'prompt'; }
}

export function saveMode(mode: NarrationMode) {
  try { storage()?.setItem(MODE_KEY, mode); } catch { /* not remembered */ }
}

export type Diagnostics = Record<string, unknown>;

// An error that carries the relay's diagnostics, so a failure can be inspected.
export class NarrationError extends Error {
  constructor(message: string, readonly diagnostics: Diagnostics | null, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = currentToken();
  if (!token) throw new Error('Connect NovelAI first.');
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-NovelAI-Token': token },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null) as { error?: unknown; diagnostics?: unknown } | null;
  if (!response.ok) {
    const diagnostics = body?.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics as Diagnostics : null;
    const message = typeof body?.error === 'string' ? body.error : body === null ? `The Praxis server answered ${response.status} with something that was not JSON. Is the API deployed?` : `Narration failed (${response.status}).`;
    throw new NarrationError(message, diagnostics, response.status);
  }
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
  diagnostics?: Diagnostics;
}

export function narrate(messages: ChatMessage[], model: string, mode: NarrationMode, signal?: AbortSignal): Promise<Narration> {
  return call<Narration>('/api/novelai/chat', {
    method: 'POST',
    body: JSON.stringify({ model, messages, mode, max_tokens: 2048, temperature: 0.8 }),
    signal,
  });
}
