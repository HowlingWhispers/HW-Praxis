// Connecting NovelAI: the player's Persistent API Token and a model.
import { useState } from 'react';
import { DEFAULT_MODEL, currentToken, forgetToken, listModels, rememberedToken, saveModel, setToken } from './novelai';

export interface Connection {
  connected: boolean;
  model: string;
}

export function Connect({ connection, onChange }: { connection: Connection; onChange: (next: Connection) => void }) {
  const [token, setTokenText] = useState('');
  const [remember, setRemember] = useState(Boolean(rememberedToken()));
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect() {
    const value = token.trim() || currentToken();
    if (!value) { setStatus('Paste your Persistent API Token first.'); return; }
    setBusy(true);
    setStatus('Connecting…');
    setToken(value, remember);
    try {
      const list = await listModels();
      setModels(list);
      const model = list.includes(connection.model) ? connection.model : list.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : list[0] ?? DEFAULT_MODEL;
      saveModel(model);
      setTokenText('');
      setStatus(`Connected. ${list.length} models available.`);
      onChange({ connected: true, model });
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
    setModels([]);
    setStatus('Disconnected. The token is no longer kept anywhere.');
    onChange({ ...connection, connected: false });
  }

  return (
    <div className="connect">
      <p className="muted">
        Narration uses your NovelAI account. Find your Persistent API Token in NovelAI under User Settings, Account.
        It is sent with each request and never stored on the server.
      </p>
      {!connection.connected && (
        <>
          <label className="field">
            <span>Persistent API Token</span>
            <input type="password" autoComplete="off" value={token} placeholder="pst-…" onChange={(event: { target: HTMLInputElement }) => setTokenText(event.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(event: { target: HTMLInputElement }) => setRemember(event.target.checked)} />
            <span>Remember on this device</span>
          </label>
          <button type="button" className="primary" onClick={connect} disabled={busy}>Connect</button>
        </>
      )}
      {connection.connected && (
        <>
          <label className="field">
            <span>Model</span>
            <select
              value={connection.model}
              onChange={(event: { target: HTMLSelectElement }) => { saveModel(event.target.value); onChange({ ...connection, model: event.target.value }); }}
            >
              {(models.length ? models : [connection.model]).map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <button type="button" onClick={disconnect}>Disconnect</button>
        </>
      )}
      {status && <p className="muted" role="status">{status}</p>}
    </div>
  );
}
