import { useMemo, useState } from 'react';
import {
  Boxes,
  BrainCircuit,
  Cpu,
  Database,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Globe2,
  Network,
  PanelRightClose,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { ArtifactMeta, Memory } from '../../shared/types';
import { useAppStore } from '../store/useAppStore';
import { useNow } from '../hooks/useNow';
import type { CogTab } from '../lib/types';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/types';
import {
  cn,
  formatBytes,
  formatElapsed,
  formatRelative,
  formatTokens,
} from '../lib/utils';
import { PlanList } from './PlanList';
import { ToolRow } from './ToolTrace';

const TABS: Array<{ id: CogTab; label: string; icon: typeof BrainCircuit }> = [
  { id: 'cognition', label: 'Cognition', icon: BrainCircuit },
  { id: 'memory', label: 'Memory', icon: Database },
  { id: 'artifacts', label: 'Artifacts', icon: Boxes },
  { id: 'system', label: 'System', icon: Cpu },
];

function artifactIcon(type: ArtifactMeta['type']) {
  if (type === 'code') return <FileCode2 size={14} />;
  if (type === 'json') return <FileJson size={14} />;
  if (type === 'html') return <Globe2 size={14} />;
  return <FileText size={14} />;
}

function uptimeText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function MemoryCard({
  memory,
  onDelete,
}: {
  memory: Memory;
  onDelete: (memory: Memory) => void;
}) {
  return (
    <article className="memory-card">
      <div className="memory-card__head">
        <span className="memory-card__importance" title={`Importance ${memory.importance}/5`}>
          {Array.from({ length: 5 }).map((_, index) => (
            <i key={index} className={index < memory.importance ? 'is-filled' : ''} />
          ))}
        </span>
        <span className="memory-card__date">{formatRelative(memory.createdAt)}</span>
        <button
          className="memory-card__delete"
          onClick={() => onDelete(memory)}
          title="Delete memory"
          aria-label="Delete memory"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <p className="memory-card__content">{memory.content}</p>
      {memory.tags.length > 0 && (
        <div className="memory-card__tags">
          {memory.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export function CognitionPanel() {
  const session = useAppStore((state) => state.session);
  const agents = useAppStore((state) => state.agents);
  const artifacts = useAppStore((state) => state.artifacts);
  const memories = useAppStore((state) => state.memories);
  const settings = useAppStore((state) => state.settings);
  const stats = useAppStore((state) => state.stats);
  const server = useAppStore((state) => state.server);
  const run = useAppStore((state) => state.run);
  const ui = useAppStore((state) => state.ui);
  const setCogTab = useAppStore((state) => state.setCogTab);
  const setCogOpen = useAppStore((state) => state.setCogOpen);
  const addMemory = useAppStore((state) => state.addMemory);
  const deleteMemory = useAppStore((state) => state.deleteMemory);
  const openArtifact = useAppStore((state) => state.openArtifact);
  const openSettings = useAppStore((state) => state.openSettings);
  const exportSession = useAppStore((state) => state.exportSession);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const now = useNow(1000);

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const [memoryTags, setMemoryTags] = useState('');
  const [memoryImportance, setMemoryImportance] = useState(3);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [artifactScope, setArtifactScope] = useState<'channel' | 'all'>('channel');

  const agent = agents.find((candidate) => candidate.id === session?.agentId);
  const activeTab = ui.cogTab;
  const liveRun = run;
  const plan = liveRun?.plan.length ? liveRun.plan : session?.plan ?? [];
  const planDone = plan.filter((task) => task.status === 'done').length;

  const channelArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.sessionId === session?.id),
    [artifacts, session?.id],
  );
  const visibleArtifacts = artifactScope === 'all' ? artifacts : channelArtifacts;

  const filteredMemories = useMemo(() => {
    const query = memoryQuery.trim().toLowerCase();
    if (!query) return memories;
    return memories.filter(
      (memory) =>
        memory.content.toLowerCase().includes(query) ||
        memory.tags.some((tag) => tag.toLowerCase().includes(query)),
    );
  }, [memories, memoryQuery]);

  const historyCalls = useMemo(() => {
    if (!session) return [];
    const calls = session.messages.flatMap((message) => message.toolCalls ?? []);
    const seen = new Set<string>();
    return calls
      .filter((call) => {
        if (seen.has(call.id)) return false;
        seen.add(call.id);
        return true;
      })
      .slice(-12)
      .reverse();
  }, [session]);

  const activeCalls = liveRun?.toolCalls.length ? [...liveRun.toolCalls].reverse() : historyCalls;
  const savedMemories = liveRun?.memories.length ? liveRun.memories : [];

  const submitMemory = async () => {
    const content = memoryText.trim();
    if (!content || memoryBusy) return;
    setMemoryBusy(true);
    const tags = memoryTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);
    const ok = await addMemory(content, tags, memoryImportance);
    setMemoryBusy(false);
    if (ok) {
      setMemoryText('');
      setMemoryTags('');
      setMemoryImportance(3);
      setMemoryOpen(false);
    }
  };

  const confirmDeleteMemory = (memory: Memory) => {
    askConfirm({
      title: 'Delete memory?',
      message: 'This cell will be removed from the durable memory index. This cannot be undone.',
      confirmLabel: 'Delete memory',
      danger: true,
      onConfirm: () => deleteMemory(memory.id),
    });
  };

  const tabs: Array<(typeof TABS)[number] & { count?: number }> = TABS.map((tab) => {
    if (tab.id === 'memory') return { ...tab, count: memories.length };
    if (tab.id === 'artifacts') return { ...tab, count: channelArtifacts.length };
    if (tab.id === 'cognition' && plan.length) return { ...tab, count: plan.length };
    return tab;
  });

  return (
    <aside className={`cognition ${ui.cogOpen ? 'is-open' : ''}`} aria-label="Cognition panel">
      <header className="cog-head">
        <div className="cog-head__title">
          <span className="eyebrow">Analysis deck</span>
          <h2>Cognition</h2>
        </div>
        <div className="cog-head__actions">
          <span className="cog-head__status">
            <span className={`status-dot ${liveRun ? 'is-live' : 'is-sim'}`} />
            {liveRun ? 'active' : 'monitoring'}
          </span>
          <button
            className="icon-btn"
            onClick={() => setCogOpen(false)}
            title="Close cognition panel"
            aria-label="Close cognition panel"
          >
            <PanelRightClose size={15} />
          </button>
        </div>
      </header>

      <nav className="cog-tabs" aria-label="Cognition tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={cn('cog-tab', activeTab === tab.id && 'is-active')}
              onClick={() => setCogTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <em>{tab.count}</em>
              )}
            </button>
          );
        })}
      </nav>

      <div className="cog-body">
        {activeTab === 'cognition' && (
          <>
            <section className="cog-block">
              <div className="cog-block__head">
                <span className="eyebrow">Runtime</span>
                {session && (
                  <span className="mono cog-block__meta">
                    RUNS {session.runCount}
                  </span>
                )}
              </div>
              <div className="cog-runtime" data-status={liveRun?.status ?? 'idle'}>
                <span
                  className="cog-runtime__dot"
                  style={{ background: liveRun ? STATUS_COLORS[liveRun.status] : undefined }}
                />
                <div className="cog-runtime__copy">
                  <strong>{liveRun ? STATUS_LABELS[liveRun.status] : 'Standby'}</strong>
                  <span>
                    {liveRun
                      ? liveRun.detail ?? 'Processing objective'
                      : 'No mission executing in this channel'}
                  </span>
                </div>
                {liveRun && (
                  <span className="cog-runtime__elapsed mono">
                    {formatElapsed(now - liveRun.startedAt)}
                  </span>
                )}
              </div>
              {liveRun?.approval && (
                <div className="cog-alert">
                  <ShieldAlert size={13} />
                  <span>
                    {liveRun.approval.toolName.replace(/_/g, ' ')} awaiting authorization
                  </span>
                </div>
              )}
              {liveRun?.notices.map((notice) => (
                <div className={`run-notice run-notice--${notice.level}`} key={notice.id}>
                  <ShieldAlert size={12} />
                  <span>{notice.text}</span>
                </div>
              ))}
            </section>

            <section className="cog-block">
              <div className="cog-block__head">
                <span className="eyebrow">Plan</span>
                <span className="cog-block__meta mono">
                  {planDone}/{plan.length}
                </span>
              </div>
              {plan.length ? (
                <PlanList tasks={plan} compact />
              ) : (
                <div className="cog-empty cog-empty--small">
                  <p>No plan has been registered. The core will publish one for multi-step work.</p>
                </div>
              )}
            </section>

            <section className="cog-block">
              <div className="cog-block__head">
                <span className="eyebrow">Tool activity</span>
                <span className="cog-block__meta mono">{activeCalls.length}</span>
              </div>
              {activeCalls.length ? (
                <div className="cog-tool-list">
                  {activeCalls.map((call) => (
                    <ToolRow key={call.id} call={call} compact />
                  ))}
                </div>
              ) : (
                <div className="cog-empty cog-empty--small">
                  <Wrench size={16} />
                  <p>Tool calls will appear here as the core executes.</p>
                </div>
              )}
            </section>

            {liveRun && liveRun.subagents.length > 0 && (
              <section className="cog-block">
                <div className="cog-block__head">
                  <span className="eyebrow">Delegation</span>
                  <span className="cog-block__meta mono">{liveRun.subagents.length}</span>
                </div>
                <div className="subagent-list subagent-list--compact">
                  {liveRun.subagents.map((trace) => (
                    <div className="subagent-row" key={trace.id} data-phase={trace.phase}>
                      <span className="subagent-row__dot" />
                      <div>
                        <div className="subagent-row__head">
                          <strong>{trace.agentName}</strong>
                          <span>{trace.phase}</span>
                        </div>
                        <p>{trace.phase === 'finished' ? trace.result ?? trace.task : trace.task}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {savedMemories.length > 0 && (
              <section className="cog-block">
                <div className="cog-block__head">
                  <span className="eyebrow">Memory committed</span>
                  <span className="cog-block__meta mono">{savedMemories.length}</span>
                </div>
                <div className="cog-memory-flash">
                  {savedMemories.map((memory) => (
                    <div key={memory.id} className="cog-memory-flash__row">
                      <Sparkles size={12} />
                      <span>{memory.content}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {liveRun && liveRun.artifacts.length > 0 && (
              <section className="cog-block">
                <div className="cog-block__head">
                  <span className="eyebrow">Artifacts emitted</span>
                  <span className="cog-block__meta mono">{liveRun.artifacts.length}</span>
                </div>
                <div className="cog-artifact-list">
                  {liveRun.artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      className="cog-artifact-row"
                      onClick={() => openArtifact(artifact.id)}
                    >
                      <span className="cog-artifact-row__icon">{artifactIcon(artifact.type)}</span>
                      <span className="cog-artifact-row__body">
                        <strong>{artifact.title}</strong>
                        <em>
                          {artifact.type} · {formatBytes(artifact.size)}
                        </em>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="cog-block cog-block--summary">
              <div className="cog-summary-grid">
                <div>
                  <span className="eyebrow">Input</span>
                  <strong>{formatTokens(session?.usage.inputTokens ?? 0)}</strong>
                </div>
                <div>
                  <span className="eyebrow">Output</span>
                  <strong>{formatTokens(session?.usage.outputTokens ?? 0)}</strong>
                </div>
                <div>
                  <span className="eyebrow">Artifacts</span>
                  <strong>{channelArtifacts.length}</strong>
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === 'memory' && (
          <div className="cog-pane">
            <div className="cog-pane__head">
              <div>
                <span className="eyebrow">Durable memory</span>
                <h3>{memories.length} cells</h3>
              </div>
              <button
                className="icon-btn icon-btn--framed"
                onClick={() => setMemoryOpen((open) => !open)}
                title={memoryOpen ? 'Close memory form' : 'Add memory'}
                aria-label="Add memory"
              >
                {memoryOpen ? <X size={14} /> : <Plus size={14} />}
              </button>
            </div>

            {memoryOpen && (
              <div className="memory-form">
                <label className="field">
                  <span className="field__label">Memory content</span>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={memoryText}
                    onChange={(event) => setMemoryText(event.target.value)}
                    placeholder="A stable preference, project fact or decision…"
                    data-autofocus
                  />
                </label>
                <label className="field">
                  <span className="field__label">Tags (comma-separated)</span>
                  <input
                    className="input"
                    value={memoryTags}
                    onChange={(event) => setMemoryTags(event.target.value)}
                    placeholder="preferences, project-x"
                  />
                </label>
                <label className="field field--range">
                  <span className="field__label">
                    Importance <strong>{memoryImportance}</strong>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={memoryImportance}
                    onChange={(event) => setMemoryImportance(Number(event.target.value))}
                  />
                </label>
                <div className="memory-form__actions">
                  <button className="btn btn--ghost btn--small" onClick={() => setMemoryOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() => void submitMemory()}
                    disabled={!memoryText.trim() || memoryBusy}
                  >
                    {memoryBusy ? 'Committing…' : 'Commit memory'}
                  </button>
                </div>
              </div>
            )}

            <div className="cog-search">
              <Search size={13} />
              <input
                value={memoryQuery}
                onChange={(event) => setMemoryQuery(event.target.value)}
                placeholder="Search memory cells…"
                aria-label="Search memories"
              />
              {memoryQuery && (
                <button onClick={() => setMemoryQuery('')} aria-label="Clear search">
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="memory-list">
              {filteredMemories.length === 0 && (
                <div className="cog-empty">
                  <Database size={20} />
                  <p>
                    {memoryQuery
                      ? 'No memory cells match this query.'
                      : 'No memories yet. The core saves durable facts here as you work.'}
                  </p>
                </div>
              )}
              {filteredMemories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} onDelete={confirmDeleteMemory} />
              ))}
            </div>
            <p className="cog-note">
              Memory is injected into every run. Auto-save is{' '}
              {settings.autoMemory ? 'enabled' : 'disabled'} in core settings.
            </p>
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="cog-pane">
            <div className="cog-pane__head">
              <div>
                <span className="eyebrow">Deliverables</span>
                <h3>{visibleArtifacts.length} artifacts</h3>
              </div>
              <div className="segmented segmented--small">
                <button
                  className={artifactScope === 'channel' ? 'is-active' : ''}
                  onClick={() => setArtifactScope('channel')}
                >
                  Channel
                </button>
                <button
                  className={artifactScope === 'all' ? 'is-active' : ''}
                  onClick={() => setArtifactScope('all')}
                >
                  All
                </button>
              </div>
            </div>

            {visibleArtifacts.length === 0 && (
              <div className="cog-empty">
                <Boxes size={20} />
                <p>
                  No artifacts {artifactScope === 'channel' ? 'in this channel' : 'yet'}. Ask the
                  core for a brief, report, code file or dataset.
                </p>
              </div>
            )}

            <div className="artifact-list">
              {visibleArtifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  className="artifact-row"
                  onClick={() => openArtifact(artifact.id)}
                >
                  <span className="artifact-row__icon">{artifactIcon(artifact.type)}</span>
                  <span className="artifact-row__body">
                    <strong>{artifact.title}</strong>
                    <em>
                      {artifact.type}
                      {artifact.language ? ` · ${artifact.language}` : ''} ·{' '}
                      {formatBytes(artifact.size)} · {formatRelative(artifact.createdAt)}
                    </em>
                  </span>
                  <span className="artifact-row__open">Open</span>
                </button>
              ))}
            </div>

            <div className="cog-artifact-hint">
              <FileText size={13} />
              <span>Artifacts are stored locally and can be downloaded from the viewer.</span>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="cog-pane">
            <div className="cog-pane__head">
              <div>
                <span className="eyebrow">Core telemetry</span>
                <h3>System</h3>
              </div>
              <button className="icon-btn icon-btn--framed" onClick={openSettings} title="Open settings">
                <Settings2 size={14} />
              </button>
            </div>

            <div className="system-card">
              <div className="system-card__head">
                <div>
                  <span className="eyebrow">Neural link</span>
                  <strong>{settings.providerStatus.label}</strong>
                </div>
                <span
                  className={`badge ${
                    settings.providerStatus.configured ? 'badge--ok' : 'badge--warn'
                  }`}
                >
                  {settings.providerStatus.configured ? 'CONFIGURED' : 'KEY REQUIRED'}
                </span>
              </div>
              <div className="system-row">
                <span>Model</span>
                <strong className="mono">{settings.model.model}</strong>
              </div>
              <div className="system-row">
                <span>Key state</span>
                <strong className="mono">
                  {settings.keyStates[settings.model.provider] ?? 'missing'}
                </strong>
              </div>
              <div className="system-row">
                <span>Temperature</span>
                <strong>{settings.model.temperature.toFixed(2)}</strong>
              </div>
              <div className="system-row">
                <span>Max steps</span>
                <strong>{settings.maxSteps}</strong>
              </div>
              <div className="system-row">
                <span>Authority</span>
                <strong>{settings.yoloMode ? 'YOLO / bypassed' : 'approval-gated'}</strong>
              </div>
            </div>

            <div className="system-card">
              <div className="system-card__head">
                <div>
                  <span className="eyebrow">Runtime</span>
                  <strong>Local node</strong>
                </div>
                <ShieldCheck size={15} />
              </div>
              <div className="system-row">
                <span>Version</span>
                <strong className="mono">v{server.version || settings.version}</strong>
              </div>
              <div className="system-row">
                <span>Node</span>
                <strong className="mono">{server.node}</strong>
              </div>
              <div className="system-row">
                <span>Uptime</span>
                <strong className="mono">{uptimeText(server.uptime)}</strong>
              </div>
              <div className="system-row system-row--stack">
                <span>Data directory</span>
                <strong className="mono system-path">{server.dataDir || settings.dataDir}</strong>
              </div>
            </div>

            <div className="system-card">
              <div className="system-card__head">
                <div>
                  <span className="eyebrow">Registry</span>
                  <strong>Core resources</strong>
                </div>
                <Network size={15} />
              </div>
              <div className="system-stats">
                <div>
                  <strong>{stats.tools}</strong>
                  <span>tools</span>
                </div>
                <div>
                  <strong>{agents.length}</strong>
                  <span>agents</span>
                </div>
                <div>
                  <strong>{memories.length}</strong>
                  <span>memories</span>
                </div>
                <div>
                  <strong>{formatTokens(stats.inputTokens + stats.outputTokens)}</strong>
                  <span>tokens</span>
                </div>
              </div>
            </div>

            <div className="system-actions">
              <button className="btn btn--ghost btn--small" onClick={exportSession}>
                <Download size={13} /> Export channel
              </button>
              <button className="btn btn--ghost btn--small" onClick={openSettings}>
                <Settings2 size={13} /> Configure core
              </button>
            </div>

            {settings.providerStatus.demo && (
              <p className="cog-note">
                Simulation core active. Every tool is real; only language synthesis is scripted.
                Add a provider key to run a live model.
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="cog-foot">
        <span className={`status-dot ${settings.providerStatus.demo ? 'is-sim' : 'is-live'}`} />
        <span>{settings.providerStatus.demo ? 'Simulation core' : 'Live model'}</span>
        <span className="cog-foot__sep" />
        <span>{agent?.callsign ?? 'CORE'}</span>
        <span className="cog-foot__spacer" />
        <span className="mono">{formatTokens(session?.usage.inputTokens ?? 0)} in</span>
        <span className="mono">{formatTokens(session?.usage.outputTokens ?? 0)} out</span>
      </footer>
    </aside>
  );
}
