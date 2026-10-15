// Connecting NovelAI with the player's Persistent API Token. The token is sent with each
// request and never stored on the server; in this browser only if the player asks.
import { useState } from 'react';
import { DEFAULT_MODEL, currentToken, forgetToken, listModels, rememberedToken, saveModel, setToken, type NarrationMode } from './novelai';

export interface Connection {
  connected: boolean;
  model: string;
  mode: NarrationMode;
  models: string[];
}

// Connects with whatever token is already known. Used at start when one was remembered.
export async function reconnect(connection: Connection): Promise<Connection> {
  if (!currentToken()) return connection;
  try {
    const models = await listModels();
    const model = models.includes(connection.model) ? connection.model : models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0] ?? DEFAULT_MODEL;
    return { ...connection, connected: true, model, models };
  } catch {
    return { ...connection, connected: false };
  }
}

export function ConnectForm({ connection, onChange }: { connection: Connection; onChange: (next: Connection) => void }) {
  const [token, setTokenText] = useState('');
  const [remember, setRemember] = useState(Boolean(rememberedToken()));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect() {
    const value = token.trim() || currentToken();
    if (!value) { setStatus('Paste your Persistent API Token first.'); return; }
    setBusy(true);
    setStatus('Connecting…');
    setToken(value, remember);
    try {
      const models = await listModels();
      const model = models.includes(connection.model) ? connection.model : models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0] ?? DEFAULT_MODEL;
      saveModel(model);
      setTokenText('');
      setStatus('');
      onChange({ ...connection, connected: true, model, models });
    } catch (error) {
      forgetToken();
      setStatus(error instanceof Error ? error.message : 'Could not connect.');
      onChange({ ...connection, connected: false });
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    forgetToken();
    setStatus('Disconnected. The token is no longer kept anywhere.');
    onChange({ ...connection, connected: false, models: [] });
  }

  if (connection.connected) {
    return (
      <div className="lr" style={{ minHeight: 64 }}>
        <span aria-hidden="true" className="dot" style={{ width: 10, height: 10, background: 'var(--good)', boxShadow: '0 0 0 4px #1d2e27' }} />
        <span className="grow">
          <span className="name" style={{ display: 'block' }}>NovelAI connected</span>
          <span className="meta" style={{ display: 'block', marginTop: 2 }}>{rememberedToken() ? 'Your token is remembered on this device' : 'Your token stays in this tab'}</span>
        </span>
        <button type="button" className="btn" onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="lr stack">
      <p className="meta" style={{ lineHeight: 1.45 }}>
        Narration uses your own NovelAI account. Find your Persistent API Token in NovelAI under User Settings, Account. It goes with each request and is never stored on the server.
      </p>
      <div>
        <label htmlFor="nai-token" className="label field-label">Persistent API Token</label>
        <input id="nai-token" className="field" type="password" autoComplete="off" value={token} placeholder="pst-…" onChange={(event) => setTokenText(event.target.value)} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}>
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} style={{ width: 20, height: 20 }} />
        Remember on this device
      </label>
      <button type="button" className="btn primary" onClick={() => void connect()} disabled={busy}>Connect NovelAI</button>
      {status && <p className="meta" role="status">{status}</p>}
    </div>
  );
}
