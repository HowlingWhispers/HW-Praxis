// Settings: narration, the journal, reading, this save, and the tools for testing.
import { exportSave, setOptions, type Options } from '../engine';
import type { PlayApi } from './Play';
import { ConnectForm } from './Connect';
import { ChevronRight, DownloadIcon, ListIcon, PulseIcon, BookIcon } from './icons';
import { SourceTag, describeEntry } from './shared';
import { saveMode, saveModel, type NarrationMode } from './novelai';
import { downloadJson, fileSafe } from './files';

function Seg<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (value: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={String(option)} type="button" aria-pressed={value === option} onClick={() => onPick(option)}>{text}</button>
      ))}
    </div>
  );
}

function Switch({ id, label, hint, on, onToggle }: { id: string; label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="lr" style={{ minHeight: 60 }}>
      <span className="grow">
        <span id={id} className="name" style={{ display: 'block' }}>{label}</span>
        {hint && <span className="meta" style={{ display: 'block', marginTop: 2, lineHeight: 1.4 }}>{hint}</span>}
      </span>
      <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby={id} onClick={onToggle} />
    </div>
  );
}

const thousands = (value: number) => value.toLocaleString('en-US');

export function SettingsSection({ api }: { api: PlayApi }) {
  const { save, connection, prefs, lastPlan } = api;
  const options = save.options;
  const change = (changes: Partial<Options>) => {
    const result = setOptions(save, changes);
    if (result.ok) api.commit(result.save); else api.notify(result.reason);
  };
  const models = connection.models.length ? connection.models : [connection.model];

  return (
    <>
      <div className="sub"><p className="label">Narration</p></div>
      <div className="card">
        <ConnectForm connection={connection} onChange={api.setConnection} />
        {connection.connected && (
          <>
            <div className="lr" style={{ minHeight: 60 }}>
              <label htmlFor="model" className="name grow">Model</label>
              <select id="model" className="select mono" style={{ width: 'auto', minHeight: 44, fontSize: 14 }} value={connection.model} onChange={(event) => { saveModel(event.target.value); api.setConnection({ ...connection, model: event.target.value }); }}>
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </div>
            <div className="lr stack">
              <span className="name">Send requests as</span>
              <Seg<NarrationMode> label="Send requests as" value={connection.mode} options={[['prompt', 'One prompt'], ['chat', 'Chat messages']]} onPick={(mode) => { saveMode(mode); api.setConnection({ ...connection, mode }); }} />
              <span className="meta" style={{ lineHeight: 1.45 }}>One prompt in the model’s own format is the one that works for GLM-4.6 on NovelAI today.</span>
            </div>
          </>
        )}
        <div className="lr stack">
          <span className="name">Longest reply</span>
          <Seg<number> label="Longest reply" value={options.replyTokens} options={[[600, '600 tokens'], [1000, '1,000'], [1600, '1,600']]} onPick={(replyTokens) => change({ replyTokens })} />
        </div>
        <div className="lr stack">
          <span className="name">The model’s window</span>
          <Seg<number> label="The model’s window" value={options.contextTokens} options={[[16000, '16k'], [24000, '24k'], [28000, '28k']]} onPick={(contextTokens) => change({ contextTokens })} />
          <span className="meta" style={{ lineHeight: 1.45 }}>
            {lastPlan
              ? `Last turn sent about ${thousands(lastPlan.estimate.total)} tokens: rules and world ${thousands(lastPlan.estimate.system)}, journal ${thousands(lastPlan.estimate.journal)}, story ${thousands(lastPlan.estimate.transcript)}, the moment ${thousands(lastPlan.estimate.moment)}. The story gets up to ${thousands(lastPlan.budget.transcriptHigh)}.`
              : 'The story gets what the window has left after the rules, the world, the journal and the moment.'}
          </span>
        </div>
      </div>

      <div className="sub"><p className="label">Journal</p></div>
      <div className="card">
        <Switch id="auto-journal" label="Suggest entries as story leaves the window" hint="You keep, edit or discard each one. Nothing joins the journal on its own." on={options.autoJournal} onToggle={() => change({ autoJournal: !options.autoJournal })} />
        <div className="lr stack">
          <span className="name">Story leaves the window in pieces of</span>
          <Seg<number> label="Piece size" value={options.pieceTokens} options={[[4000, '4,000 tokens'], [6000, '6,000'], [9000, '9,000']]} onPick={(pieceTokens) => change({ pieceTokens })} />
          <span className="meta" style={{ lineHeight: 1.45 }}>Each piece becomes one suggested entry. Bigger pieces mean fewer, broader entries and fewer changes to what the narrator is sent.</span>
        </div>
        <div className="lr stack">
          <span className="name">Journal budget</span>
          <Seg<number> label="Journal budget" value={options.journalTokens} options={[[2000, '2,000 tokens'], [3000, '3,000'], [5000, '5,000']]} onPick={(journalTokens) => change({ journalTokens })} />
        </div>
        <Switch id="auto-compress" label="Suggest compressing older entries" hint="When the journal passes its budget. The originals are archived, not deleted." on={options.autoCompress} onToggle={() => change({ autoCompress: !options.autoCompress })} />
        {connection.connected && (
          <div className="lr" style={{ minHeight: 60 }}>
            <label htmlFor="helper-model" className="name grow">Suggestions written by</label>
            <select id="helper-model" className="select mono" style={{ width: 'auto', minHeight: 44, fontSize: 14 }} value={models.includes(prefs.helperModel) ? prefs.helperModel : connection.model} onChange={(event) => api.setPrefs({ helperModel: event.target.value })}>
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="sub"><p className="label">Checks</p><button type="button" className="link" onClick={() => api.open('guide')}>How checks work</button></div>
      <div className="card">
        <div className="lr stack">
          <span className="name">When you make a check</span>
          <Seg<string> label="When you make a check" value={options.alwaysSucceed ? 'succeed' : 'roll'} options={[['roll', 'Roll the dice'], ['succeed', 'Succeed, no roll']]} onPick={(pick) => change({ alwaysSucceed: pick === 'succeed' })} />
          <span className="meta" style={{ lineHeight: 1.45 }}>Either choice is always one tap away on the check itself. The ledger records who decided.</span>
        </div>
      </div>

      <div className="sub"><p className="label">Reading</p></div>
      <div className="card">
        <div className="lr stack">
          <span className="name">Text size</span>
          <Seg label="Text size" value={prefs.textSize} options={[['small', 'Smaller'], ['standard', 'Standard'], ['large', 'Larger']]} onPick={(textSize) => api.setPrefs({ textSize })} />
        </div>
        <div className="lr stack">
          <span className="name">Story typeface</span>
          <Seg label="Story typeface" value={prefs.storyFace} options={[['serif', 'Book serif'], ['sans', 'Plain sans']]} onPick={(storyFace) => api.setPrefs({ storyFace })} />
        </div>
      </div>

      <div className="sub"><p className="label">This save</p><span className="meta">{api.module.name}</span></div>
      <div className="card clip">
        <button type="button" className="lr" onClick={() => downloadJson(`${fileSafe(api.name)}.praxis.json`, exportSave(api.module, save, api.name))}>
          <DownloadIcon /><span className="name grow">Export this save</span><span className="meta">to a file</span>
        </button>
        <details style={{ borderTop: '1px solid var(--line)' }}>
          <summary className="lr" style={{ borderTop: 0 }}><ListIcon /><span className="name grow">Ledger</span><span className="meta">{save.ledger.length} changes</span><ChevronRight /></summary>
          {save.ledger.length ? (
            <ol className="ledger">
              {save.ledger.slice(-60).reverse().map((entry, index) => (
                <li key={save.ledger.length - index}><span className="what">{describeEntry(api.world, entry)}</span><SourceTag source={entry.source} /></li>
              ))}
            </ol>
          ) : <p className="meta" style={{ padding: '0 14px 14px' }}>Nothing has changed yet.</p>}
        </details>
      </div>

      <div className="sub"><p className="label">Testing</p><span className="meta">hidden in release</span></div>
      <div className="card clip">
        <Switch id="show-drafts" label="Show draft markers" hint="On records the module marks unfinished" on={prefs.showDrafts} onToggle={() => api.setPrefs({ showDrafts: !prefs.showDrafts })} />
        <Switch id="show-numbers" label="Show numbers beside bands" on={prefs.showNumbers} onToggle={() => api.setPrefs({ showNumbers: !prefs.showNumbers })} />
        <details style={{ borderTop: '1px solid var(--line)' }}>
          <summary className="lr" style={{ borderTop: 0 }}><BookIcon /><span className="name grow">What the narrator was sent</span><ChevronRight /></summary>
          <div style={{ padding: '0 14px 14px' }}>
            {lastPlan ? (
              <ol className="sent">
                {lastPlan.messages.map((message, index) => <li key={index}><span className="label">{message.role}</span><pre>{message.content}</pre></li>)}
              </ol>
            ) : <p className="meta">Nothing yet this session.</p>}
          </div>
        </details>
        <details style={{ borderTop: '1px solid var(--line)' }}>
          <summary className="lr" style={{ borderTop: 0 }}><PulseIcon /><span className="name grow">Diagnostics</span><span className="meta">last 10 calls</span><ChevronRight /></summary>
          <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {api.calls.length ? (
              <ol className="sent">
                {api.calls.map((call, index) => (
                  <li key={index}>
                    <span className={call.ok ? 'meta' : 'bad'} style={{ fontSize: 13 }}>{call.at} · {call.purpose} · {call.ok ? `ok, ${call.ms} ms` : 'failed'} · {call.message}</span>
                    {call.diagnostics && <pre>{JSON.stringify(call.diagnostics, null, 2)}</pre>}
                  </li>
                ))}
              </ol>
            ) : <p className="meta">No calls yet this session.</p>}
            <button type="button" className="btn" disabled={!api.calls.length} onClick={() => void navigator.clipboard?.writeText(JSON.stringify(api.calls, null, 2))}>Copy diagnostics</button>
            <p className="meta">Estimate: about {(1 / options.tokensPerChar).toFixed(1)} characters per token, corrected from NovelAI’s own counts.</p>
          </div>
        </details>
      </div>

      <button type="button" className="btn wide" style={{ marginTop: 18 }} onClick={api.leave}>Leave for the title screen</button>
      <p className="version">Praxis {__PRAXIS_VERSION__} · {api.module.name} {api.module.version}</p>
    </>
  );
}
