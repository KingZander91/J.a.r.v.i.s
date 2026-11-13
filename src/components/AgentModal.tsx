import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { AccentId, AgentIcon, ToolInfo } from '../../shared/types';
import { ACCENT_LIST, accentHex } from '../lib/accents';
import { cn } from '../lib/utils';
import { useAppStore } from '../store/useAppStore';
import { AgentSigil } from './AgentSigil';
import { Modal } from './Modal';

const ICON_OPTIONS: Array<{ id: AgentIcon; label: string }> = [
  { id: 'core', label: 'Core' },
  { id: 'oracle', label: 'Oracle' },
  { id: 'forge', label: 'Forge' },
  { id: 'scribe', label: 'Scribe' },
  { id: 'sentinel', label: 'Sentinel' },
  { id: 'ultron', label: 'Ultron' },
  { id: 'nexus', label: 'Nexus' },
  { id: 'custom', label: 'Custom' },
];

function groupTools(tools: ToolInfo[]): Array<{ category: string; tools: ToolInfo[] }> {
  const map = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const list = map.get(tool.category) ?? [];
    list.push(tool);
    map.set(tool.category, list);
  }
  return [...map.entries()]
    .map(([category, list]) => ({
      category,
      tools: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function AgentModal() {
  const ui = useAppStore((state) => state.ui);
  const agents = useAppStore((state) => state.agents);
  const tools = useAppStore((state) => state.tools);
  const closeAgentModal = useAppStore((state) => state.closeAgentModal);
  const saveAgent = useAppStore((state) => state.saveAgent);
  const deleteAgent = useAppStore((state) => state.deleteAgent);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const open = ui.agentModal.open;
  const agentId = ui.agentModal.agentId;
  const existing = agents.find((agent) => agent.id === agentId);

  const [name, setName] = useState('');
  const [callsign, setCallsign] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [accent, setAccent] = useState<AccentId>('teal');
  const [icon, setIcon] = useState<AgentIcon>('custom');
  const [allTools, setAllTools] = useState(true);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [toolQuery, setToolQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name);
      setCallsign(existing.callsign);
      setDescription(existing.description);
      setSystemPrompt(existing.systemPrompt);
      setAccent(existing.accent);
      setIcon(existing.icon);
      const wildcard = existing.tools.includes('*');
      setAllTools(wildcard);
      setSelectedTools(wildcard ? [] : existing.tools);
    } else {
      setName('');
      setCallsign('');
      setDescription('');
      setSystemPrompt('');
      setAccent('teal');
      setIcon('custom');
      setAllTools(true);
      setSelectedTools([]);
    }
    setToolQuery('');
    setError(null);
    setSaving(false);
  }, [open, existing?.id]);

  const groups = useMemo(() => groupTools(tools), [tools]);
  const filteredGroups = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter(
          (tool) =>
            tool.name.toLowerCase().includes(query) ||
            tool.description.toLowerCase().includes(query) ||
            group.category.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.tools.length > 0);
  }, [groups, toolQuery]);

  const toggleTool = (toolName: string) => {
    setSelectedTools((current) =>
      current.includes(toolName)
        ? current.filter((name) => name !== toolName)
        : [...current, toolName],
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Agent name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await saveAgent(agentId, {
      name: name.trim(),
      callsign: (callsign.trim() || name.trim()).toUpperCase(),
      description: description.trim(),
      systemPrompt,
      accent,
      icon,
      tools: allTools ? ['*'] : selectedTools,
    });
    setSaving(false);
    if (ok) closeAgentModal();
  };

  const handleDelete = () => {
    if (!existing || existing.builtin) return;
    askConfirm({
      title: 'Decommission agent?',
      message: `“${existing.name}” will be removed from the agent deck. Existing channels keep their transcripts.`,
      confirmLabel: 'Decommission',
      danger: true,
      onConfirm: async () => {
        await deleteAgent(existing.id);
        closeAgentModal();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={closeAgentModal}
      title={existing ? 'Edit intelligence' : 'New intelligence'}
      subtitle={
        existing
          ? 'Adjust the agent persona, authority and tool grants.'
          : 'Create a specialist profile with its own doctrine and tool access.'
      }
      eyebrow="Agent profile"
      icon={<Bot size={18} />}
      width={900}
      className="modal--agent"
      footer={
        <>
          {existing && !existing.builtin ? (
            <button className="btn btn--danger btn--ghost-danger" onClick={handleDelete} disabled={saving}>
              <Trash2 size={13} /> Decommission
            </button>
          ) : (
            <span className="modal__hint">
              {existing?.builtin ? 'Built-in profile · cannot be deleted' : 'New profile'}
            </span>
          )}
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={closeAgentModal} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Committing…' : existing ? 'Save profile' : 'Deploy intelligence'}
            </button>
          </div>
        </>
      }
    >
      <div className="agent-editor">
        <div className="agent-preview" style={{ '--agent-color': accentHex(accent) } as React.CSSProperties}>
          <span className="agent-preview__sigil">
            <AgentSigil icon={icon} size={54} />
          </span>
          <div className="agent-preview__copy">
            <span className="eyebrow">{existing?.builtin ? 'Built-in intelligence' : 'Custom intelligence'}</span>
            <strong>{name || 'Unnamed agent'}</strong>
            <span>{callsign || 'CALLSIGN'} · {allTools ? 'all tools' : `${selectedTools.length} tools`}</span>
            <p>{description || 'A specialist intelligence operating inside the JARVIS core.'}</p>
          </div>
          {existing && (
            <span className={cn('badge', existing.builtin ? 'badge--sim' : 'badge--ok')}>
              {existing.builtin ? 'CORE PROFILE' : 'CUSTOM'}
            </span>
          )}
        </div>

        <div className="agent-editor__grid">
          <label className="field">
            <span className="field__label">Agent name</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. ATLAS"
              maxLength={40}
              data-autofocus
            />
          </label>
          <label className="field">
            <span className="field__label">Callsign</span>
            <input
              className="input mono"
              value={callsign}
              onChange={(event) => setCallsign(event.target.value.toUpperCase())}
              placeholder="ATLAS"
              maxLength={20}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            className="textarea"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this intelligence is responsible for."
            maxLength={240}
          />
        </label>

        <div className="agent-editor__styles">
          <div className="field">
            <span className="field__label">Accent</span>
            <div className="accent-picker">
              {ACCENT_LIST.map((option) => (
                <button
                  key={option.id}
                  className={cn('accent-dot', accent === option.id && 'is-active')}
                  style={{ background: option.hex }}
                  onClick={() => setAccent(option.id)}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={accent === option.id}
                >
                  {accent === option.id && <Check size={11} />}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">Sigil</span>
            <div className="icon-picker">
              {ICON_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={cn('icon-choice', icon === option.id && 'is-active')}
                  onClick={() => setIcon(option.id)}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={icon === option.id}
                  style={{ color: accentHex(accent) }}
                >
                  <AgentSigil icon={option.id} size={24} orbit={false} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="field">
          <span className="field__label">System prompt / operating doctrine</span>
          <textarea
            className="textarea agent-editor__prompt"
            rows={7}
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="Define the agent's role, methodology, constraints and output style."
          />
        </label>

        <section className="agent-tools">
          <div className="agent-tools__head">
            <div>
              <span className="eyebrow">Authority</span>
              <h3>Tool grants</h3>
            </div>
            <div className="agent-tools__head-right">
              <span className="agent-tools__count">
                {allTools ? tools.length : selectedTools.length} / {tools.length}
              </span>
              <button
                className={cn('btn btn--small', allTools ? 'btn--primary' : 'btn--ghost')}
                onClick={() => {
                  setAllTools((value) => !value);
                  setSelectedTools([]);
                }}
              >
                {allTools ? <Check size={12} /> : <Plus size={12} />}
                {allTools ? 'All tools' : 'Grant all'}
              </button>
            </div>
          </div>

          {allTools ? (
            <div className="agent-all-tools">
              <Wrench size={16} />
              <div>
                <strong>Wildcard authority</strong>
                <span>
                  This agent can call every registered tool, including approval-gated execution.
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="cog-search agent-tools__search">
                <Search size={13} />
                <input
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder="Filter tools…"
                  aria-label="Filter tools"
                />
                {toolQuery && (
                  <button onClick={() => setToolQuery('')} aria-label="Clear tool filter">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="tool-groups">
                {filteredGroups.length === 0 && (
                  <div className="cog-empty cog-empty--small">
                    <p>No tools match this filter.</p>
                  </div>
                )}
                {filteredGroups.map((group) => (
                  <div className="tool-group" key={group.category}>
                    <div className="tool-group__label">
                      <span>{group.category}</span>
                      <span className="mono">{group.tools.length}</span>
                    </div>
                    {group.tools.map((tool) => {
                      const checked = selectedTools.includes(tool.name);
                      return (
                        <button
                          key={tool.name}
                          className={cn('tool-choice', checked && 'is-checked')}
                          onClick={() => toggleTool(tool.name)}
                          aria-pressed={checked}
                        >
                          <span className="tool-choice__check">
                            {checked && <Check size={10} strokeWidth={3} />}
                          </span>
                          <span className="tool-choice__body">
                            <span className="tool-choice__name">
                              {tool.name.replace(/_/g, ' ')}
                              {tool.requiresApproval && (
                                <span className="tool-choice__gated">
                                  <ShieldAlert size={10} /> gated
                                </span>
                              )}
                            </span>
                            <span className="tool-choice__desc">{tool.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {error && <div className="inline-error">{error}</div>}
      </div>
    </Modal>
  );
}
