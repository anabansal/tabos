import { AlertTriangle, Check, Sparkles, X, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { buildProposal } from '../../ai/organize';
import { resolveProviders } from '../../ai/providers';
import { db } from '../../shared/db';
import { rpc } from '../../shared/messages';
import type { GroupColor, OrganizeProposal, ProposedGroup } from '../../shared/types';
import { GROUP_COLORS } from '../../shared/types';
import { Banner, EmptyState, Favicon, Menu, Toggle, WsDot } from '../../ui/components';
import { errorMessage, useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { isLive, useData } from '../data';

type Scope = 'unassigned' | 'all';

interface EditableGroup extends ProposedGroup {
  accepted: boolean;
}

export function OrganizeView() {
  const { records, workspaces, settings, saveSettings } = useData();
  const fb = useFeedback();
  const [scope, setScope] = useState<Scope>('unassigned');
  const [chromeGroups, setChromeGroups] = useState(settings.workspaces.syncTabGroups);
  const [stage, setStage] = useState<{ label: string; done?: number; total?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<(Omit<OrganizeProposal, 'groups'> & { groups: EditableGroup[]; warnings: string[] }) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const providers = useMemo(() => resolveProviders(settings.ai), [settings.ai]);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  const live = records.filter(isLive);
  const inScope = scope === 'unassigned' ? live.filter((r) => !r.workspaceId) : live;

  const run = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProposal(null);
    setStage({ label: 'Starting' });
    try {
      const members = await db.tabs.where('workspaceId').anyOf(workspaces.map((w) => w.id)).toArray();
      const p = await buildProposal({
        records: inScope,
        workspaceMembers: members,
        workspaces,
        embedding: providers.embedding,
        language: providers.language,
        exclusions: settings.exclusions,
        minGroupSize: settings.ai.minGroupSize,
        signal: ctrl.signal,
        onProgress: (label, done, total) => setStage({ label, done, total }),
      });
      if (!ctrl.signal.aborted) setProposal({ ...p, groups: p.groups.map((g) => ({ ...g, accepted: true })) });
    } catch (err) {
      if (!ctrl.signal.aborted) setError(errorMessage(err));
    } finally {
      if (!ctrl.signal.aborted) setStage(null);
    }
  };

  const update = (id: string, patch: Partial<EditableGroup>) =>
    setProposal((p) => p && { ...p, groups: p.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  const moveTab = (recordId: string, toGroup: string | null) =>
    setProposal((p) => {
      if (!p) return p;
      const groups = p.groups.map((g) => ({ ...g, recordIds: g.recordIds.filter((x) => x !== recordId) }));
      const unassigned = p.unassigned.filter((x) => x !== recordId);
      if (toGroup) groups.find((g) => g.id === toGroup)?.recordIds.push(recordId);
      else unassigned.push(recordId);
      return { ...p, groups, unassigned };
    });

  const accepted = proposal?.groups.filter((g) => g.accepted && g.recordIds.length && g.name.trim()) ?? [];
  const tabCount = accepted.reduce((n, g) => n + g.recordIds.length, 0);
  const apply = async () => {
    if (!proposal) return;
    const newOnes = accepted.filter((g) => !g.existingWorkspaceId).length;
    const ok = await fb.confirm({
      title: `Organize ${plural(tabCount, 'tab')} into ${plural(accepted.length, 'workspace')}?`,
      body: `${newOnes ? `Creates ${plural(newOnes, 'new workspace')}. ` : ''}${chromeGroups ? 'Tabs are also grouped in Chrome. ' : ''}No tab is closed. You can undo this in one click.`,
      confirmLabel: 'Apply',
    });
    if (!ok) return;
    const r = await fb.run(
      () =>
        rpc('organize.apply', {
          groups: accepted.map((g) => ({ name: g.name.trim(), summary: g.summary, color: g.color, recordIds: g.recordIds, existingWorkspaceId: g.existingWorkspaceId })),
          createChromeGroups: chromeGroups,
        }),
      (x) => `Organized ${plural(x.count, 'tab')}`,
    );
    if (r) setProposal(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Organize</h1>
          <div className="sub">TabOS suggests workspaces from your open tabs. You review and edit them; nothing changes until you apply.</div>
        </div>
      </div>

      {!proposal && (
        <div className="card card-pad col" style={{ gap: 14, maxWidth: 720 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Which tabs">
              <option value="unassigned">Tabs without a workspace ({live.filter((r) => !r.workspaceId).length})</option>
              <option value="all">All open tabs ({live.length})</option>
            </select>
            <label className="check">
              <input type="checkbox" checked={chromeGroups} onChange={(e) => setChromeGroups(e.target.checked)} /> Also group them in Chrome
            </label>
            <div className="spacer" />
            <button className="btn primary" disabled={!!stage || inScope.length < 2} onClick={run}>
              <Sparkles /> Suggest workspaces
            </button>
          </div>
          {stage ? (
            <div className="col" style={{ gap: 6 }}>
              <span className="muted">
                {stage.label}
                {stage.total ? ` · ${stage.done}/${stage.total}` : '…'}
              </span>
              <div className="progress">
                <div style={{ transform: `scaleX(${stage.total ? (stage.done ?? 0) / stage.total : 0.35})` }} />
              </div>
            </div>
          ) : (
            <span className="faint" style={{ fontSize: 12 }}>
              Using {providers.language.id === 'local' ? providers.embedding.label : `${providers.embedding.label} and ${providers.language.label}`}.{' '}
              {providers.embedding.local && providers.language.local ? 'Nothing leaves this device.' : 'Tab titles and URLs are sent to the provider you connected.'} <a href="#/settings#ai">Change</a>
            </span>
          )}
          {inScope.length < 2 && !stage && <span className="muted">Open a few more tabs (or pick “All open tabs”) to get suggestions.</span>}
          <hr className="divider" />
          <label className="row" style={{ gap: 10 }}>
            <Toggle checked={settings.workspaces.autoOrganize} onChange={(v) => saveSettings({ workspaces: { autoOrganize: v } }).catch(fb.error)} label="Auto-organize" />
            <span>
              <strong>Keep sorting new tabs automatically</strong>
              <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                Confident matches only. Creates topic workspaces once 3 tabs share a topic. Undo any time.
              </span>
            </span>
          </label>
        </div>
      )}

      {providers.warnings.map((w) => (
        <Banner key={w} kind="warn" icon={AlertTriangle}>
          {w}
        </Banner>
      ))}
      {error && (
        <Banner kind="error" icon={AlertTriangle}>
          Couldn't build suggestions: {error}
        </Banner>
      )}

      {proposal && (
        <>
          {proposal.warnings.map((w) => (
            <Banner key={w} kind="info" icon={AlertTriangle}>
              {w}
            </Banner>
          ))}
          {!proposal.groups.length ? (
            <div className="card">
              <EmptyState icon={Sparkles} title="No clear groups found">
                These tabs don't share enough in common yet. Try “All open tabs”, or create a workspace by hand.
              </EmptyState>
            </div>
          ) : (
            <div className="proposal-grid">
              {proposal.groups.map((g) => (
                <GroupCard key={g.id} g={g} groups={proposal.groups} byId={byId} onChange={(patch) => update(g.id, patch)} onMove={moveTab} />
              ))}
            </div>
          )}
          {proposal.unassigned.length > 0 && (
            <details className="card">
              <summary className="card-pad" style={{ cursor: 'pointer' }}>
                {plural(proposal.unassigned.length, 'tab')} left as they are
              </summary>
              <div style={{ paddingBottom: 8 }}>
                {proposal.unassigned.map((id) => {
                  const r = byId.get(id);
                  if (!r) return null;
                  return (
                    <div key={id} className="row" style={{ padding: '5px 16px', fontSize: 12.5 }}>
                      <Favicon url={r.url} size={14} />
                      <span className="ellipsis grow">{r.title}</span>
                      <select className="select" style={{ height: 24, fontSize: 12 }} value="" onChange={(e) => e.target.value && moveTab(id, e.target.value)} aria-label="Add to group">
                        <option value="">Add to…</option>
                        {proposal.groups.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
          <div className="clean-foot">
            <span className="muted">
              {accepted.length ? `${plural(accepted.length, 'workspace')} · ${plural(tabCount, 'tab')}` : 'No groups selected'}
            </span>
            <div className="spacer" />
            <button className="btn" onClick={() => setProposal(null)}>
              <RotateCcw /> Start over
            </button>
            <button className="btn primary" disabled={!accepted.length} onClick={apply}>
              <Check /> Apply
            </button>
          </div>
        </>
      )}
    </>
  );
}

function GroupCard({
  g,
  groups,
  byId,
  onChange,
  onMove,
}: {
  g: EditableGroup;
  groups: EditableGroup[];
  byId: Map<string, import('../../shared/types').TabRecord>;
  onChange: (patch: Partial<EditableGroup>) => void;
  onMove: (recordId: string, toGroup: string | null) => void;
}) {
  return (
    <section className={`card group-card ${g.accepted ? '' : 'rejected'}`}>
      <div className="head">
        <div className="row">
          <Menu
            align="left"
            trigger={(t) => (
              <button className="btn ghost icon sm" aria-label="Color" onClick={t}>
                <WsDot color={g.color} size={12} />
              </button>
            )}
            items={GROUP_COLORS.map((c: GroupColor) => ({ label: c[0].toUpperCase() + c.slice(1), onClick: () => onChange({ color: c }) }))}
          />
          <input className="input name-input grow" value={g.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Workspace name" disabled={!!g.existingWorkspaceId} />
          <button
            className={`btn sm ${g.accepted ? '' : 'primary'}`}
            onClick={() => onChange({ accepted: !g.accepted })}
            aria-pressed={!g.accepted}
            title={g.accepted ? 'Skip this group' : 'Include this group'}
          >
            {g.accepted ? <X /> : <Check />} {g.accepted ? 'Skip' : 'Include'}
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="pill">{g.existingWorkspaceId ? 'Adds to existing workspace' : 'New workspace'}</span>
          <span className="faint" style={{ fontSize: 12 }}>
            {plural(g.recordIds.length, 'tab')} · {g.basis}
          </span>
        </div>
        {g.summary && <span className="muted" style={{ fontSize: 12 }}>{g.summary}</span>}
      </div>
      <div className="tabs">
        {g.recordIds.map((id) => {
          const r = byId.get(id);
          if (!r) return null;
          return (
            <div className="tab" key={id}>
              <Favicon url={r.url} size={14} />
              <span className="ellipsis" title={r.title}>
                {r.title}
              </span>
              <select className="select" value="" onChange={(e) => onMove(id, e.target.value === '__none' ? null : e.target.value)} aria-label="Move tab">
                <option value="">Move…</option>
                {groups
                  .filter((x) => x.id !== g.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                <option value="__none">Leave out</option>
              </select>
            </div>
          );
        })}
        {!g.recordIds.length && <div className="faint" style={{ padding: '8px 14px' }}>No tabs left in this group.</div>}
      </div>
    </section>
  );
}
