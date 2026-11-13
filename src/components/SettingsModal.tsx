import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Cpu,
  Database,
  Globe2,
  KeyRound,
  Palette,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ProviderId } from '../../shared/types';
import { api } from '../lib/api';
import { ACCENT_LIST } from '../lib/accents';
import { cn } from '../lib/utils';
import { useAppStore } from '../store/useAppStore';
import { usePrefsStore } from '../store/prefsStore';
import { useSpeech } from '../hooks/useSpeech';
import { Modal } from './Modal';

type SettingsTab = 'neural' | 'search' | 'behavior' | 'interface' | 'system';

interface Draft {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  autoMemory: boolean;
  yoloMode: boolean;
  approvalTimeoutMs: number;
  systemPromptExtra: string;
}

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Cpu }> = [
  { id: 'neural', label: 'Neural link', icon: Sparkles },
  { id: 'search', label: 'Search uplink', icon: Globe2 },
  { id: 'behavior', label: 'Core behavior', icon: SlidersHorizontal },
  { id: 'interface', label: 'Interface', icon: Palette },
  { id: 'system', label: 'System', icon: Server },
];

const KEY_LABELS: Record<string, string> = {
  env: 'ENV',
  saved: 'SAVED',
  missing: 'MISSING',
  not_required: 'NO KEY',
};

function Toggle({
  checked,
  onChange,
  title,
  description,
  danger,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={cn('toggle-row', disabled && 'is-disabled')}>
      <div className="toggle-row__copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className={cn('toggle', checked && 'is-on', danger && 'toggle--danger')}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle__thumb" />
      </button>
    </div>
  );
}

export function SettingsModal() {
  const settings = useAppStore((state) => state.settings);
  const providerPresets = useAppStore((state) => state.providerPresets);
  const tools = useAppStore((state) => state.tools);
  const server = useAppStore((state) => state.server);
  const stats = useAppStore((state) => state.stats);
  const run = useAppStore((state) => state.run);
  const ui = useAppStore((state) => state.ui);
  const closeSettings = useAppStore((state) => state.closeSettings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const resetAllData = useAppStore((state) => state.resetAllData);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const saveProviderKey = useAppStore((state) => state.saveProviderKey);
  const saveTavilyKey = useAppStore((state) => state.saveTavilyKey);
  const theme = usePrefsStore((state) => state.theme);
  const setTheme = usePrefsStore((state) => state.setTheme);
  const sound = usePrefsStore((state) => state.sound);
  const setSound = usePrefsStore((state) => state.setSound);
  const reduceMotion = usePrefsStore((state) => state.reduceMotion);
  const setReduceMotion = usePrefsStore((state) => state.setReduceMotion);
  const tts = usePrefsStore((state) => state.tts);
  const setTts = usePrefsStore((state) => state.setTts);
  const autoSpeak = usePrefsStore((state) => state.autoSpeak);
  const setAutoSpeak = usePrefsStore((state) => state.setAutoSpeak);
  const voiceURI = usePrefsStore((state) => state.voiceURI);
  const setVoiceURI = usePrefsStore((state) => state.setVoiceURI);
  const speech = useSpeech();
  const [tab, setTab] = useState<SettingsTab>('neural');
  const [draft, setDraft] = useState<Draft>(() => ({
    provider: settings.model.provider,
    model: settings.model.model,
    baseUrl: settings.model.baseUrl,
    temperature: settings.model.temperature,
    maxTokens: settings.model.maxTokens,
    maxSteps: settings.maxSteps,
    autoMemory: settings.autoMemory,
    yoloMode: settings.yoloMode,
    approvalTimeoutMs: settings.approvalTimeoutMs,
    systemPromptExtra: settings.systemPromptExtra,
  }));
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [tavilyInput, setTavilyInput] = useState('');
  const [tavilyBusy, setTavilyBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  useEffect(() => {
    if (!ui.settingsOpen) return;
    setDraft({
      provider: settings.model.provider,
      model: settings.model.model,
      baseUrl: settings.model.baseUrl,
      temperature: settings.model.temperature,
      maxTokens: settings.model.maxTokens,
      maxSteps: settings.maxSteps,
      autoMemory: settings.autoMemory,
      yoloMode: settings.yoloMode,
      approvalTimeoutMs: settings.approvalTimeoutMs,
      systemPromptExtra: settings.systemPromptExtra,
    });
    setKeyInput('');
    setTavilyInput('');
    setTestState(null);
    setTab('neural');
    // Only reseed the draft when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.settingsOpen]);

  const preset = useMemo(
    () => providerPresets.find((item) => item.id === draft.provider),
    [providerPresets, draft.provider],
  );
  const keyState = settings.keyStates[draft.provider] ?? 'missing';
  const simulated = draft.provider === 'demo';
  const researchTools = tools.filter((tool) => /search|fetch|research/i.test(`${tool.name} ${tool.category}`));

  const selectProvider = (provider: ProviderId) => {
    const next = providerPresets.find((item) => item.id === provider);
    setDraft((current) => ({
      ...current,
      provider,
      model: next?.model ?? current.model,
      baseUrl: next?.baseUrl ?? '',
    }));
    setKeyInput('');
    setTestState(null);
  };

  const persistDraft = async (): Promise<boolean> => {
    setSaving(true);
    const ok = await saveSettings({
      model: {
        provider: draft.provider,
        model: draft.model.trim() || 'jarvis-sim-1',
        baseUrl: draft.baseUrl.trim(),
        temperature: draft.temperature,
        maxTokens: draft.maxTokens,
      },
      maxSteps: draft.maxSteps,
      autoMemory: draft.autoMemory,
      yoloMode: draft.yoloMode,
      approvalTimeoutMs: draft.approvalTimeoutMs,
      systemPromptExtra: draft.systemPromptExtra,
    });
    setSaving(false);
    return ok;
  };

  const handleSave = async (close = true) => {
    const ok = await persistDraft();
    if (ok && close) closeSettings();
  };

  const handleKeySave = async () => {
    setKeyBusy(true);
    const ok = await saveProviderKey(draft.provider, keyInput.trim() || null);
    setKeyBusy(false);
    if (ok) setKeyInput('');
  };

  const handleTavilySave = async () => {
    setTavilyBusy(true);
    const ok = await saveTavilyKey(tavilyInput.trim() || null);
    setTavilyBusy(false);
    if (ok) setTavilyInput('');
  };

  const handleResetData = () => {
    askConfirm({
      title: 'Erase all local data?',
      message: `This permanently erases ${stats.sessions} channel${stats.sessions === 1 ? '' : 's'}, ${stats.memories} memor${stats.memories === 1 ? 'y' : 'ies'}, ${stats.artifacts} artifact${stats.artifacts === 1 ? '' : 's'} and every custom agent, then clears the workspace directory. Built-in intelligences, settings and saved API keys are kept. This cannot be undone.`,
      confirmLabel: 'Erase everything',
      danger: true,
      onConfirm: async () => {
        const ok = await resetAllData();
        if (ok) closeSettings();
      },
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestState(null);
    if (keyInput.trim()) {
      const keyOk = await saveProviderKey(draft.provider, keyInput.trim());
      if (!keyOk) {
        setTesting(false);
        return;
      }
      setKeyInput('');
    }
    const saved = await persistDraft();
    if (!saved) {
      setTesting(false);
      return;
    }
    try {
      const result = await api.testProvider();
      setTestState(result);
    } catch (error) {
      setTestState({
        ok: false,
        message: error instanceof Error ? error.message : 'Connection test failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={ui.settingsOpen}
      onClose={closeSettings}
      title="Core configuration"
      subtitle="Model link, authority, memory and interface preferences."
      eyebrow="J.A.R.V.I.S. control surface"
      icon={<Settings2 size={18} />}
      width={1040}
      className="modal--settings"
      bodyClassName="settings-body"
      footer={
        <>
          <span className="modal__hint">
            Model and behavior settings are stored by the local core.
          </span>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={closeSettings} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={() => void handleSave(true)} disabled={saving}>
              {saving ? 'Committing…' : 'Save configuration'}
            </button>
          </div>
        </>
      }
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn('settings-nav__btn', tab === item.id && 'is-active')}
                onClick={() => setTab(item.id)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="settings-nav__note">
            <ShieldAlert size={13} />
            <span>Secrets stay on this machine in a local file.</span>
          </div>
        </nav>

        <div className="settings-content">
          {tab === 'neural' && (
            <>
              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Provider</span>
                    <h3>Neural link</h3>
                    <p>Choose the language model that drives the agent runtime.</p>
                  </div>
                  <span className={`badge ${simulated ? 'badge--sim' : settings.providerStatus.configured ? 'badge--ok' : 'badge--warn'}`}>
                    {simulated ? 'SIMULATION' : settings.providerStatus.configured ? 'CONFIGURED' : 'KEY REQUIRED'}
                  </span>
                </div>
                <div className="provider-grid">
                  {providerPresets.map((provider) => {
                    const selected = draft.provider === provider.id;
                    const state = settings.keyStates[provider.id] ?? 'missing';
                    return (
                      <button
                        key={provider.id}
                        className={cn('provider-card', selected && 'is-selected')}
                        onClick={() => selectProvider(provider.id)}
                      >
                        <span className="provider-card__top">
                          <strong>{provider.label}</strong>
                          {selected && <Check size={13} />}
                        </span>
                        <span className="provider-card__hint">{provider.hint}</span>
                        <span className="provider-card__tags">
                          {provider.local && <em className="tag">LOCAL</em>}
                          {provider.id === 'demo' && <em className="tag">NO KEY</em>}
                          {provider.keyRequired && (
                            <em className={cn('tag', state === 'missing' && 'tag--warn')}>
                              {KEY_LABELS[state] ?? state.toUpperCase()}
                            </em>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Parameters</span>
                    <h3>Model settings</h3>
                  </div>
                </div>
                <div className="field-grid">
                  <label className="field">
                    <span className="field__label">Model ID</span>
                    <input
                      className="input mono"
                      value={draft.model}
                      onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                      placeholder={preset?.model ?? 'model-id'}
                      disabled={simulated}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Base URL</span>
                    <input
                      className="input mono"
                      value={draft.baseUrl}
                      onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      placeholder={preset?.baseUrl || 'Leave blank for provider default'}
                      disabled={simulated}
                    />
                    <span className="field__hint">
                      {preset?.local
                        ? 'Local OpenAI-compatible server.'
                        : 'Blank uses the provider preset endpoint.'}
                    </span>
                  </label>
                  <label className="field field--range">
                    <span className="field__label">
                      Temperature <strong>{draft.temperature.toFixed(2)}</strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={draft.temperature}
                      onChange={(event) =>
                        setDraft({ ...draft, temperature: Number(event.target.value) })
                      }
                      disabled={simulated}
                    />
                    <span className="field__hint">Lower is precise; higher is exploratory.</span>
                  </label>
                  <label className="field">
                    <span className="field__label">Max output tokens</span>
                    <input
                      className="input mono"
                      type="number"
                      min={256}
                      max={32768}
                      step={256}
                      value={draft.maxTokens}
                      onChange={(event) =>
                        setDraft({ ...draft, maxTokens: Number(event.target.value) })
                      }
                      disabled={simulated}
                    />
                  </label>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Credentials</span>
                    <h3>API key</h3>
                    <p>
                      {simulated
                        ? 'The simulation core needs no credentials and never calls a model API.'
                        : keyState === 'env'
                          ? 'This provider key is supplied by an environment variable.'
                          : keyState === 'not_required'
                            ? 'No key is required for this endpoint. Optional tokens are accepted.'
                            : 'The key is written to the local secrets file with owner-only permissions.'}
                    </p>
                  </div>
                  <span className={cn('badge', keyState === 'missing' ? 'badge--warn' : 'badge--ok')}>
                    <KeyRound size={11} /> {KEY_LABELS[keyState] ?? keyState.toUpperCase()}
                  </span>
                </div>
                {!simulated && (
                  <>
                    <div className="key-row">
                      <div className="key-row__input">
                        <KeyRound size={14} />
                        <input
                          type="password"
                          value={keyInput}
                          onChange={(event) => setKeyInput(event.target.value)}
                          placeholder={
                            keyState === 'saved'
                              ? '•••••••••••••••• saved — enter a replacement'
                              : keyState === 'env'
                                ? 'Environment key active'
                                : 'Paste provider API key'
                          }
                          autoComplete="off"
                          disabled={keyState === 'env'}
                        />
                      </div>
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() => void handleKeySave()}
                        disabled={keyBusy || keyState === 'env' || (!keyInput.trim() && keyState !== 'saved')}
                      >
                        {keyBusy ? 'Sealing…' : keyInput.trim() ? 'Save key' : 'Remove key'}
                      </button>
                    </div>
                    <span className="settings-hint">
                      Keys are never sent to the interface after saving. Save the key before testing
                      the connection.
                    </span>
                  </>
                )}
              </section>

              <section className="settings-section settings-section--test">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Diagnostic</span>
                    <h3>Connection test</h3>
                    <p>Save the current draft, then send a minimal completion request.</p>
                  </div>
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => void handleTest()}
                    disabled={testing || saving}
                  >
                    {testing ? 'Testing…' : 'Test connection'}
                  </button>
                </div>
                {testState && (
                  <div className={cn('test-result', testState.ok ? 'is-ok' : 'is-error')}>
                    <strong>{testState.ok ? 'LINK ESTABLISHED' : 'LINK FAILED'}</strong>
                    <p>{testState.message}</p>
                    {testState.latencyMs != null && testState.latencyMs > 0 && (
                      <span className="mono">{testState.latencyMs}ms round-trip</span>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {tab === 'search' && (
            <>
              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Web research</span>
                    <h3>Search uplink</h3>
                    <p>
                      Tavily adds high-quality, LLM-ready web results. Without it, the core uses a
                      multi-source public fallback stack.
                    </p>
                  </div>
                  <span className={`badge ${settings.tavilyConfigured ? 'badge--ok' : 'badge--warn'}`}>
                    <Search size={11} /> {settings.tavilyConfigured ? 'TAVILY ACTIVE' : 'FALLBACK ACTIVE'}
                  </span>
                </div>
                <div className="key-row">
                  <div className="key-row__input">
                    <Globe2 size={14} />
                    <input
                      type="password"
                      value={tavilyInput}
                      onChange={(event) => setTavilyInput(event.target.value)}
                      placeholder={
                        settings.tavilyConfigured
                          ? '••••••••••••• saved — enter a replacement'
                          : 'Paste Tavily API key (optional)'
                      }
                      autoComplete="off"
                    />
                  </div>
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => void handleTavilySave()}
                    disabled={tavilyBusy || (!tavilyInput.trim() && !settings.tavilyConfigured)}
                  >
                    {tavilyBusy ? 'Saving…' : tavilyInput.trim() ? 'Save key' : 'Remove key'}
                  </button>
                </div>

                <div className="fallback-grid">
                  {[
                    ['Google News RSS', 'live headlines'],
                    ['Hacker News', 'Algolia index'],
                    ['Wikipedia', 'reference context'],
                    ['Bing News', 'coverage breadth'],
                    ['Semantic Scholar', 'academic papers'],
                  ].map(([name, hint]) => (
                    <div className="fallback-item" key={name}>
                      <span className="fallback-item__dot" />
                      <strong>{name}</strong>
                      <span>{hint}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Registry</span>
                    <h3>Research tools</h3>
                    <p>Tool calls are real, regardless of whether synthesis is simulated.</p>
                  </div>
                </div>
                <div className="settings-tool-list">
                  {researchTools.map((tool) => (
                    <div className="settings-tool-row" key={tool.name}>
                      <div>
                        <strong>{tool.name.replace(/_/g, ' ')}</strong>
                        <span>{tool.description}</span>
                      </div>
                      {tool.requiresApproval && <span className="tag tag--warn">GATED</span>}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === 'behavior' && (
            <>
              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Autonomy</span>
                    <h3>Core behavior</h3>
                    <p>Controls how far the agent may go before it stops or asks.</p>
                  </div>
                </div>
                <div className="field-grid">
                  <label className="field field--range">
                    <span className="field__label">
                      Max agent steps <strong>{draft.maxSteps}</strong>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={24}
                      value={draft.maxSteps}
                      onChange={(event) =>
                        setDraft({ ...draft, maxSteps: Number(event.target.value) })
                      }
                    />
                    <span className="field__hint">Hard ceiling on tool/model round-trips per run.</span>
                  </label>
                  <label className="field">
                    <span className="field__label">Approval window</span>
                    <select
                      className="select"
                      value={draft.approvalTimeoutMs}
                      onChange={(event) =>
                        setDraft({ ...draft, approvalTimeoutMs: Number(event.target.value) })
                      }
                    >
                      <option value={60_000}>1 minute</option>
                      <option value={180_000}>3 minutes</option>
                      <option value={300_000}>5 minutes</option>
                      <option value={600_000}>10 minutes</option>
                      <option value={900_000}>15 minutes</option>
                      <option value={1_800_000}>30 minutes</option>
                    </select>
                    <span className="field__hint">
                      Time allowed to authorize a gated tool call.
                    </span>
                  </label>
                </div>
                <div className="toggle-stack">
                  <Toggle
                    checked={draft.autoMemory}
                    onChange={(value) => setDraft({ ...draft, autoMemory: value })}
                    title="Automatic memory"
                    description="Let the core save stable preferences and project facts without asking first."
                  />
                  <Toggle
                    checked={draft.yoloMode}
                    onChange={(value) => setDraft({ ...draft, yoloMode: value })}
                    title="YOLO mode — bypass approval gates"
                    description="Execute gated tools immediately, including code execution and workspace writes. Use only in a trusted environment."
                    danger
                  />
                </div>
                {draft.yoloMode && (
                  <div className="settings-warning">
                    <ShieldAlert size={14} />
                    <span>
                      YOLO mode removes the operator interlock. The core can execute JavaScript and
                      write to its sandbox without asking.
                    </span>
                  </div>
                )}
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Doctrine</span>
                    <h3>System prompt extension</h3>
                    <p>Appended to every agent's system prompt for this deployment.</p>
                  </div>
                </div>
                <label className="field">
                  <span className="field__label">Additional instructions</span>
                  <textarea
                    className="textarea"
                    rows={5}
                    value={draft.systemPromptExtra}
                    onChange={(event) =>
                      setDraft({ ...draft, systemPromptExtra: event.target.value })
                    }
                    placeholder="e.g. Always answer as if briefing a time-constrained executive. Prefer bullet points for operational detail."
                  />
                </label>
              </section>
            </>
          )}

          {tab === 'interface' && (
            <>
              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Appearance</span>
                    <h3>Reactor accent</h3>
                    <p>Changes the HUD, reactor bloom and interface accent immediately.</p>
                  </div>
                </div>
                <div className="theme-grid">
                  {ACCENT_LIST.map((accent) => (
                    <button
                      key={accent.id}
                      className={cn('theme-swatch', theme === accent.id && 'is-selected')}
                      onClick={() => setTheme(accent.id)}
                      aria-pressed={theme === accent.id}
                    >
                      <span className="theme-swatch__dot" style={{ background: accent.hex }} />
                      <span>{accent.label}</span>
                      {theme === accent.id && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Experience</span>
                    <h3>Interface preferences</h3>
                    <p>Stored in this browser, separate from core settings.</p>
                  </div>
                </div>
                <div className="toggle-stack">
                  <Toggle
                    checked={sound}
                    onChange={setSound}
                    title="Interface sound"
                    description="Subtle synthesized tones for sends, tools, approvals and failures."
                  />
                  <Toggle
                    checked={reduceMotion}
                    onChange={setReduceMotion}
                    title="Reduce motion"
                    description="Slow the reactor and suppress ambient motion for calmer viewing."
                  />
                  <Toggle
                    checked={tts}
                    onChange={setTts}
                    title="Voice synthesis"
                    description="Allow the interface to speak assistant replies."
                  />
                  <Toggle
                    checked={autoSpeak}
                    onChange={setAutoSpeak}
                    title="Auto-speak completed replies"
                    description="Read new assistant messages aloud when a run finishes."
                    disabled={!tts}
                  />
                </div>
                <label className="field voice-select">
                  <span className="field__label">Voice</span>
                  <select
                    className="select"
                    value={voiceURI}
                    onChange={(event) => setVoiceURI(event.target.value)}
                    disabled={!tts || speech.voices.length === 0}
                  >
                    <option value="">System default</option>
                    {speech.voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} — {voice.lang}
                      </option>
                    ))}
                  </select>
                  {!speech.supported && (
                    <span className="field__hint">
                      Speech synthesis is not available in this browser.
                    </span>
                  )}
                </label>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Keyboard</span>
                    <h3>Shortcuts</h3>
                  </div>
                </div>
                <div className="shortcut-list">
                  {[
                    ['⌘K / Ctrl K', 'Command palette'],
                    ['⌘B / Ctrl B', 'Toggle sidebar'],
                    ['⌘J / Ctrl J', 'Toggle cognition'],
                    ['Esc', 'Close topmost surface'],
                    ['Enter', 'Send directive'],
                    ['Shift Enter', 'New line'],
                  ].map(([keys, action]) => (
                    <div className="shortcut-row" key={keys}>
                      <span>{action}</span>
                      <kbd>{keys}</kbd>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === 'system' && (
            <>
              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Runtime</span>
                    <h3>Local core</h3>
                    <p>Data stays on this machine unless a provider or web tool is called.</p>
                  </div>
                  <span className="badge badge--ok">ONLINE</span>
                </div>
                <div className="system-info-grid">
                  <div>
                    <span>Version</span>
                    <strong>v{server.version || settings.version}</strong>
                  </div>
                  <div>
                    <span>Node</span>
                    <strong>{server.node}</strong>
                  </div>
                  <div>
                    <span>Uptime</span>
                    <strong>{server.uptime}s</strong>
                  </div>
                  <div>
                    <span>Data dir</span>
                    <strong className="system-path">{server.dataDir || settings.dataDir}</strong>
                  </div>
                  <div>
                    <span>Tools</span>
                    <strong>{stats.tools}</strong>
                  </div>
                  <div>
                    <span>Runs</span>
                    <strong>{stats.runs}</strong>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Key vault</span>
                    <h3>Provider credentials</h3>
                    <p>Environment keys take precedence over locally saved keys.</p>
                  </div>
                </div>
                <div className="key-state-list">
                  {providerPresets
                    .filter((provider) => provider.id !== 'demo')
                    .map((provider) => {
                      const state = settings.keyStates[provider.id] ?? 'missing';
                      return (
                        <div className="key-state-row" key={provider.id}>
                          <span>{provider.label}</span>
                          <span
                            className={cn(
                              'tag',
                              state === 'missing' && 'tag--warn',
                              (state === 'saved' || state === 'env') && 'tag--ok',
                            )}
                          >
                            {KEY_LABELS[state] ?? state.toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Storage</span>
                    <h3>Privacy model</h3>
                  </div>
                  <Database size={16} />
                </div>
                <ul className="privacy-list">
                  <li>Conversations, memories and artifacts persist as local JSON.</li>
                  <li>Provider keys live in a local secrets file with owner-only permissions.</li>
                  <li>No telemetry, analytics or remote account is required.</li>
                  <li>Web search and model traffic only leave the device when those tools run.</li>
                  <li>The code sandbox is isolated from the host filesystem.</li>
                </ul>
              </section>

              <section className="settings-section settings-section--danger">
                <div className="settings-section__head">
                  <div>
                    <span className="eyebrow">Danger zone</span>
                    <h3>Delete all data</h3>
                    <p>
                      Wipes channels, messages, memories, artifacts and custom agents, then clears
                      the workspace directory.
                    </p>
                  </div>
                  <span className="badge badge--warn">
                    <Trash2 size={11} /> IRREVERSIBLE
                  </span>
                </div>
                <div className="danger-row">
                  <div className="danger-row__copy">
                    <strong>Erase local content</strong>
                    <span>Settings, provider keys and built-in intelligences are preserved.</span>
                  </div>
                  <button
                    className="btn btn--ghost-danger"
                    onClick={handleResetData}
                    disabled={Boolean(run)}
                  >
                    <Trash2 size={13} /> Delete all data
                  </button>
                </div>
                {run && (
                  <span className="settings-hint">
                    Cancel the active mission before erasing data. The core refuses to wipe while a
                    run is streaming.
                  </span>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
