import { CheckCircle2, Download, KeyRound, Lock, Plus, RefreshCw, Upload, X, AlertTriangle, Keyboard } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { providerOrigins, providersForTest } from '../../ai/providers';
import { rpc, type ExportBundle, type WorkerStatus } from '../../shared/messages';
import { usesExternalProvider, type AISettings, type SettingsPatch } from '../../shared/settings';
import { Banner, Toggle } from '../../ui/components';
import { errorMessage, useFeedback } from '../../ui/feedback';
import { agoLong, plural } from '../../ui/format';
import { usePermission } from '../../ui/hooks';
import { useData } from '../data';

const SLEEP_PRESETS = [15, 30, 45, 60, 120, 240, 480];

function Setting({ title, desc, children, stack }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`setting ${stack ? 'stack' : ''}`}>
      <div>
        <div style={{ fontWeight: 550 }}>{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsView() {
  const { settings: s, saveSettings } = useData();
  const fb = useFeedback();
  const save = (patch: SettingsPatch) => saveSettings(patch).catch(fb.error);
  const [more, setMore] = useState(() => location.hash.includes('#ai') || location.hash.includes('more'));

  return (
    <>
      <div className="page-intro">
          <p className="lede">The defaults work well for most people. Saved automatically.</p>
      </div>

      <section className="list-card" style={{ maxWidth: 780 }}>
        <Setting
          title="Group new tabs automatically"
          desc="New tabs join the group they clearly belong to, and a new group appears once 3 tabs share a topic. Runs privately on this computer. You can undo any change."
        >
          <Toggle checked={s.workspaces.autoOrganize} onChange={(v) => save({ workspaces: { autoOrganize: v } })} label="Auto-organize" />
        </Setting>
        <Setting title="Put idle tabs to sleep" desc="Frees memory. Tabs stay in your tab strip and reload when clicked. Tabs playing audio, visible, or protected never sleep.">
          <div className="row">
            {s.sleep.enabled && (
              <select className="select" value={s.sleep.afterMinutes} onChange={(e) => save({ sleep: { afterMinutes: Number(e.target.value) } })} aria-label="Sleep after">
                {[...new Set([...SLEEP_PRESETS, s.sleep.afterMinutes])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    after {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            )}
            <Toggle checked={s.sleep.enabled} onChange={(v) => save({ sleep: { enabled: v } })} label="Auto-sleep" />
          </div>
        </Setting>
        <Setting
          title="Archive tabs I haven’t used in a while"
          desc="Closes long-unused tabs and keeps them under Archived. You get a notification with Undo each time. Off by default; Tidy Up always asks first."
        >
          <div className="row">
            {s.archive.mode === 'auto' && (
              <select className="select" value={s.archive.afterDays} onChange={(e) => save({ archive: { afterDays: Number(e.target.value) } })} aria-label="Archive after">
                {[...new Set([3, 7, 14, 30, s.archive.afterDays])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    after {plural(d, 'day')}
                  </option>
                ))}
              </select>
            )}
            <Toggle checked={s.archive.mode === 'auto'} onChange={(v) => save({ archive: { mode: v ? 'auto' : 'off' } })} label="Auto-archive" />
          </div>
        </Setting>
        <ProtectedSites values={s.protectedDomains} onChange={(v) => save({ protectedDomains: v })} />
      </section>

      {!more ? (
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(true)}>
          More settings
        </button>
      ) : (
        <>
          <Group title="Groups">
            <Setting title="New tabs join the group they were opened from" desc="Open a link from a tab in “Coding” and the new tab is in “Coding” too.">
              <Toggle checked={s.workspaces.autoAssignNewTabs} onChange={(v) => save({ workspaces: { autoAssignNewTabs: v } })} label="Auto-assign" />
            </Setting>
            <Setting title="Match Chrome tab groups" desc="Groups appear as Chrome tab groups, and a tab group you name in Chrome becomes a group here.">
              <div className="row">
                <button className="btn sm" onClick={() => fb.run(() => rpc('workspaces.importGroups', {}), (r) => `Imported ${plural(r.count, 'workspace')}`)}>
                  Import groups now
                </button>
                <Toggle checked={s.workspaces.syncTabGroups} onChange={(v) => save({ workspaces: { syncTabGroups: v } })} label="Sync tab groups" />
              </div>
            </Setting>
            <Setting title="When showing a group, collapse the others in Chrome">
              <Toggle checked={s.workspaces.collapseOthersOnSwitch} onChange={(v) => save({ workspaces: { collapseOthersOnSwitch: v } })} label="Collapse others" />
            </Setting>
            <Setting title="When showing a group, put the others to sleep">
              <Toggle checked={s.workspaces.sleepOthersOnSwitch} onChange={(v) => save({ workspaces: { sleepOthersOnSwitch: v } })} label="Sleep others" />
            </Setting>
          </Group>

          <Group title="Sleeping, reopening and history">
            <Setting title="Pinned tabs never sleep automatically">
              <Toggle checked={s.sleep.protectPinned} onChange={(v) => save({ sleep: { protectPinned: v } })} label="Protect pinned" />
            </Setting>
            <Setting title="Reopen many tabs without slowing down" desc="When reopening several tabs, only the first loads; the rest load when you click them.">
              <Toggle checked={s.restore.lazy} onChange={(v) => save({ restore: { lazy: v } })} label="Lazy restore" />
            </Setting>
            <Setting title="Save sessions automatically" desc="Saves all your windows every so often, so you can recover after a crash. Find them in History → Saved Sessions.">
              <div className="row">
                {s.snapshots.autoEnabled && (
                  <select className="select" value={s.snapshots.intervalMinutes} onChange={(e) => save({ snapshots: { intervalMinutes: Number(e.target.value) } })} aria-label="Snapshot interval">
                    {[15, 30, 60, 180].map((m) => (
                      <option key={m} value={m}>
                        every {m < 60 ? `${m} min` : `${m / 60} h`}
                      </option>
                    ))}
                  </select>
                )}
                <Toggle checked={s.snapshots.autoEnabled} onChange={(v) => save({ snapshots: { autoEnabled: v } })} label="Auto snapshots" />
              </div>
            </Setting>
            <Setting title="Keep recently closed tabs for" desc="Archived tabs and sessions you save are never removed automatically.">
              <select className="select" value={s.history.closedRetentionDays} onChange={(e) => save({ history: { closedRetentionDays: Number(e.target.value) } })} aria-label="Retention">
                {[7, 30, 60, 180, 365, 0].map((d) => (
                  <option key={d} value={d}>
                    {d ? plural(d, 'day') : 'Forever'}
                  </option>
                ))}
              </select>
            </Setting>
            <Setting title="Sites TabOS should leave alone" desc="Domains or patterns like example.com/admin*. Matching tabs are never put to sleep, archived, grouped or sent to an AI service." stack>
              <ListEditor values={s.exclusions} placeholder="example.com/private*" onChange={(v) => save({ exclusions: v })} />
            </Setting>
          </Group>

          <AISection ai={s.ai} save={save} />
          <PrivacySection />

          <Group title="Appearance">
            <Setting title="Theme">
              <select className="select" value={s.ui.theme} onChange={(e) => save({ ui: { theme: e.target.value as 'system' } })} aria-label="Theme">
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Setting>
            <Setting title="Show open-tab count on the toolbar icon">
              <Toggle checked={s.ui.badge === 'open'} onChange={(v) => save({ ui: { badge: v ? 'open' : 'none' } })} label="Badge" />
            </Setting>
            <Setting title="Keyboard shortcuts" desc="Alt+Shift+K opens the popup, Alt+Shift+D the dashboard. Type “tab” and a space in the address bar to search.">
              <button className="btn sm" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                <Keyboard /> Customize
              </button>
            </Setting>
          </Group>

          <DataSection />
        </>
      )}
    </>
  );
}

function Group({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section className="col" style={{ gap: 8, maxWidth: 780 }} id={id}>
      <h2>{title}</h2>
      <div className="list-card">{children}</div>
    </section>
  );
}

const FRIENDLY: Record<string, string> = {
  'meet.google.com': 'Google Meet',
  'zoom.us': 'Zoom',
  'teams.microsoft.com': 'Teams',
  'teams.live.com': 'Teams',
  'mail.google.com': 'Gmail',
  'calendar.google.com': 'Google Calendar',
  'outlook.office.com': 'Outlook',
  'outlook.live.com': 'Outlook',
  'web.whatsapp.com': 'WhatsApp',
  'app.slack.com': 'Slack',
  'discord.com': 'Discord',
  'music.youtube.com': 'YouTube Music',
  'open.spotify.com': 'Spotify',
};
const friendlySite = (d: string) => FRIENDLY[d] ?? d;

/** Summary first ("Google Meet, Zoom and 11 more"), full editor one click deeper. */
function ProtectedSites({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const pretty = values.slice(0, 3).map(friendlySite);
  return (
    <div className="setting stack">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div style={{ fontWeight: 550 }}>Sites that always stay awake</div>
          <div className="desc">
            {values.length ? `${pretty.join(', ')}${values.length > 3 ? ` and ${values.length - 3} more` : ''}. Calls, chat and music keep working.` : 'None. Add sites like video calls or chat.'}
          </div>
        </div>
        <button className="btn sm" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing && <ListEditor values={values} placeholder="example.com" onChange={onChange} />}
    </div>
  );
}

function ListEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!v || values.includes(v)) return setText('');
    onChange([...values, v]);
    setText('');
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="list-editor">
        {values.map((v) => (
          <span key={v} className="tag">
            {v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              <X style={{ width: 12, height: 12 }} />
            </button>
          </span>
        ))}
        {!values.length && <span className="faint">None</span>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input" style={{ width: 260 }} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label="Add entry" />
        <button className="btn sm" type="submit" disabled={!text.trim()}>
          <Plus /> Add
        </button>
      </form>
    </div>
  );
}

// ---------- AI ----------

function AISection({ ai, save }: { ai: AISettings; save: (p: SettingsPatch) => Promise<unknown> }) {
  const [draft, setDraft] = useState(ai);
  const [test, setTest] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => setDraft(ai), [ai]);
  const custom = draft.embeddingProvider !== 'local' || draft.languageProvider !== 'local';
  const [open, setOpen] = useState(custom);
  const external = usesExternalProvider(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(ai);
  const set = (patch: Partial<AISettings>) => setDraft((d) => ({ ...d, ...patch }));

  const saveAndTest = async () => {
    setTesting(true);
    setTest(null);
    const lines: string[] = [];
    let ok = true;
    try {
      const origins = providerOrigins(draft);
      if (origins.length) {
        const granted = await chrome.permissions.request({ origins });
        if (!granted) throw new Error('Access to the provider was not granted.');
      }
      await save({ ai: draft });
      const p = providersForTest(draft);
      for (const [label, fn] of [
        ['Embeddings', () => p.embedding.test()],
        ['Naming', () => p.language.test()],
      ] as const) {
        try {
          lines.push(`${label}: ${await fn()}`);
        } catch (err) {
          ok = false;
          lines.push(`${label}: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      ok = false;
      lines.push(errorMessage(err));
    }
    setTest({ ok, lines });
    setTesting(false);
  };

  return (
    <Group title="AI" id="ai">
      <Setting
        title={
          <span className="row" style={{ gap: 6 }}>
            <Lock style={{ width: 14, height: 14, color: 'var(--st-open)' }} /> Built-in AI, private and offline
          </span>
        }
        desc="Grouping, search and similar tabs run inside the extension. No account, no cost, nothing sent anywhere."
      >
        <button className="btn sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Use another AI service'}
        </button>
      </Setting>
      {open && (
        <div className="col" style={{ padding: '4px 16px 16px', gap: 14 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="muted">Embeddings (search, grouping)</span>
              <select className="select" value={draft.embeddingProvider} onChange={(e) => set({ embeddingProvider: e.target.value as AISettings['embeddingProvider'] })}>
                <option value="local">Built-in (offline)</option>
                <option value="ollama">Ollama (runs on your computer)</option>
                <option value="openai">OpenAI-compatible API</option>
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="muted">Naming and summaries</span>
              <select className="select" value={draft.languageProvider} onChange={(e) => set({ languageProvider: e.target.value as AISettings['languageProvider'] })}>
                <option value="local">Built-in (offline)</option>
                <option value="ollama">Ollama (runs on your computer)</option>
                <option value="openai">OpenAI-compatible API</option>
                <option value="anthropic">Anthropic API</option>
              </select>
            </label>
          </div>
          {(draft.embeddingProvider === 'ollama' || draft.languageProvider === 'ollama') && (
            <Fields title="Ollama">
              <Field label="Server URL" value={draft.ollama.baseUrl} onChange={(v) => set({ ollama: { ...draft.ollama, baseUrl: v } })} />
              <Field label="Embedding model" value={draft.ollama.embedModel} onChange={(v) => set({ ollama: { ...draft.ollama, embedModel: v } })} />
              <Field label="Chat model" value={draft.ollama.chatModel} onChange={(v) => set({ ollama: { ...draft.ollama, chatModel: v } })} />
            </Fields>
          )}
          {(draft.embeddingProvider === 'openai' || draft.languageProvider === 'openai') && (
            <Fields title="OpenAI-compatible (OpenAI, OpenRouter, Groq, LM Studio…)">
              <Field label="Base URL" value={draft.openai.baseUrl} onChange={(v) => set({ openai: { ...draft.openai, baseUrl: v } })} />
              <Field label="API key" secret value={draft.openai.apiKey} onChange={(v) => set({ openai: { ...draft.openai, apiKey: v } })} />
              <Field label="Embedding model" value={draft.openai.embedModel} onChange={(v) => set({ openai: { ...draft.openai, embedModel: v } })} />
              <Field label="Chat model" value={draft.openai.chatModel} onChange={(v) => set({ openai: { ...draft.openai, chatModel: v } })} />
            </Fields>
          )}
          {draft.languageProvider === 'anthropic' && (
            <Fields title="Anthropic">
              <Field label="API key" secret value={draft.anthropic.apiKey} onChange={(v) => set({ anthropic: { ...draft.anthropic, apiKey: v } })} />
              <Field label="Model" value={draft.anthropic.model} onChange={(v) => set({ anthropic: { ...draft.anthropic, model: v } })} />
            </Fields>
          )}
          {external && (
            <label className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={draft.externalConsent} onChange={(e) => set({ externalConsent: e.target.checked })} style={{ marginTop: 2 }} />
              <span>
                <strong>Allow sending tab titles and URLs</strong> (and page descriptions, if collected) to this provider when I use Group Tabs, Search or Similar tabs. Page contents are never sent. Excluded sites are never sent. API keys are stored only on this device.
              </span>
            </label>
          )}
          <div className="row">
            <button className="btn primary" disabled={testing || (external && !draft.externalConsent)} onClick={saveAndTest}>
              {testing ? <div className="spinner" /> : null} Save and test
            </button>
            {dirty && <span className="faint">Unsaved changes</span>}
            {external && !draft.externalConsent && <span className="faint">Allow sending above to continue.</span>}
          </div>
          {test && (
            <Banner kind={test.ok ? 'info' : 'error'} icon={test.ok ? CheckCircle2 : AlertTriangle}>
              {test.lines.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </Banner>
          )}
        </div>
      )}
    </Group>
  );
}

function Fields({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="col" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', gap: 8, margin: 0 }}>
      <legend className="muted" style={{ padding: '0 4px' }}>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({ label, value, onChange, secret }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean }) {
  return (
    <label className="row" style={{ gap: 10 }}>
      <span className="muted" style={{ width: 130, flex: 'none' }}>
        {label}
      </span>
      <input className="input grow" type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------- privacy & permissions ----------

function PrivacySection() {
  const { settings: s, saveSettings } = useData();
  const fb = useFeedback();
  const [meta, requestMeta, revokeMeta] = usePermission({ permissions: ['scripting'], origins: ['http://*/*', 'https://*/*'] });
  const [hist, requestHist, revokeHist] = usePermission({ permissions: ['history'] });
  const [sess, requestSess, revokeSess] = usePermission({ permissions: ['sessions'] });

  const toggleMeta = async (on: boolean) => {
    if (on) {
      const ok = meta || (await requestMeta());
      if (!ok) return fb.toast('Permission not granted', { kind: 'error' });
      await saveSettings({ privacy: { collectPageMeta: true } });
      await fb.run(() => rpc('meta.collect', {}), (r) => `Read descriptions of ${plural(r.count, 'page')}`);
    } else {
      await saveSettings({ privacy: { collectPageMeta: false } });
    }
  };
  const perm = (granted: boolean | null, request: () => Promise<boolean>, revoke: () => Promise<void>) => (
    <button className="btn sm" onClick={() => (granted ? revoke() : request())}>
      {granted ? 'Remove access' : 'Allow'}
    </button>
  );

  return (
    <Group title="Privacy and permissions">
      <Setting
        title="Read page descriptions for better search"
        desc="Reads only the <meta> description and keywords of pages you open, never page text. Never runs on AI chat apps, email, banking or sign-in pages. Needs access to sites."
      >
        <Toggle checked={s.privacy.collectPageMeta && !!meta} onChange={toggleMeta} label="Page descriptions" />
      </Setting>
      <Setting title="Chrome history" desc="Search your history from TabOS. Read on demand; never stored by TabOS.">
        {perm(hist, requestHist, revokeHist)}
      </Setting>
      <Setting title="Chrome's recently closed list" desc="Restore tabs and windows with their back/forward history.">
        {perm(sess, requestSess, revokeSess)}
      </Setting>
      {meta && !s.privacy.collectPageMeta && (
        <Setting title="Site access is granted but unused">
          {perm(meta, requestMeta, revokeMeta)}
        </Setting>
      )}
      <div className="setting stack">
        <div className="desc row" style={{ gap: 8 }}>
          <KeyRound style={{ width: 14, height: 14 }} />
          Always on: reading tab titles and URLs (to track tabs), tab groups, local storage, alarms, notifications (only for auto-archive), favicons and system memory. All data stays on this device.
        </div>
      </div>
    </Group>
  );
}

function DataSection() {
  const fb = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  useEffect(() => {
    rpc('system.status', {}).then(setStatus).catch(() => setStatus(null));
  }, []);
  const exportData = async () => {
    try {
      const bundle = await rpc('data.export', {});
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tabos-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      fb.toast(`Exported ${plural(bundle.tabs.length, 'tab')}`);
    } catch (err) {
      fb.error(err);
    }
  };
  const importData = async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text()) as ExportBundle;
      if (bundle?.format !== 'tabos-export') throw new Error('This file is not a TabOS export.');
      if (!(await fb.confirm({ title: 'Import this file?', body: `${plural(bundle.tabs?.length ?? 0, 'tab')}, ${plural(bundle.workspaces?.length ?? 0, 'group')} and ${plural(bundle.snapshots?.length ?? 0, 'snapshot')} will be merged. Nothing existing is overwritten; imported open tabs arrive as archived.`, confirmLabel: 'Import' })))
        return;
      await fb.run(() => rpc('data.import', { bundle }), (r) => `Imported ${plural(r.count, 'item')}`);
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <Group title="Data">
      <Setting title="Export" desc="Tabs, groups, sessions and settings as a file. API keys are left out.">
        <button className="btn sm" onClick={exportData}>
          <Download /> Export
        </button>
      </Setting>
      <Setting title="Import" desc="Merge a TabOS export from another computer or profile.">
        <>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            <Upload /> Import
          </button>
        </>
      </Setting>
      <Setting
        title="Re-check open tabs"
        desc={status ? `Last checked ${agoLong(status.lastReconcileAt)}. Storage ${status.db.ok ? 'OK' : 'unavailable'}.${status.lastError ? ` Last issue: ${status.lastError}` : ''}` : 'Matches TabOS records with Chrome’s tabs.'}
      >
        <button className="btn sm" onClick={() => fb.run(() => rpc('system.reconcile', {}), (r) => `Checked: ${r.message ?? 'done'}`)}>
          <RefreshCw /> Re-check
        </button>
      </Setting>
    </Group>
  );
}
