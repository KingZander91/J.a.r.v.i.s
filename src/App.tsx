import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { usePrefsStore } from './store/prefsStore';
import { applyAccent } from './lib/accents';
import { STATUS_LABELS } from './lib/types';
import { cn } from './lib/utils';
import { BootScreen } from './components/BootScreen';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { CoreView } from './components/CoreView';
import { ChatView } from './components/ChatView';
import { CognitionPanel } from './components/CognitionPanel';
import { SettingsModal } from './components/SettingsModal';
import { AgentModal } from './components/AgentModal';
import { ArtifactModal } from './components/ArtifactModal';
import { CommandPalette } from './components/CommandPalette';
import { ApprovalModal } from './components/ApprovalModal';
import { QuestionModal } from './components/QuestionModal';
import { ConfirmModal } from './components/ConfirmModal';
import { ToastViewport } from './components/ToastViewport';
import { SpeechProvider } from './hooks/useSpeech';

export default function App() {
  const init = useAppStore((state) => state.init);
  const retryInit = useAppStore((state) => state.retryInit);
  const bootState = useAppStore((state) => state.bootState);
  const bootError = useAppStore((state) => state.bootError);
  const initialized = useAppStore((state) => state.initialized);
  const view = useAppStore((state) => state.view);
  const session = useAppStore((state) => state.session);
  const run = useAppStore((state) => state.run);
  const ui = useAppStore((state) => state.ui);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const setUI = useAppStore((state) => state.setUI);
  const setCogOpen = useAppStore((state) => state.setCogOpen);
  const openPalette = useAppStore((state) => state.openPalette);
  const closePalette = useAppStore((state) => state.closePalette);
  const closeSettings = useAppStore((state) => state.closeSettings);
  const closeAgentModal = useAppStore((state) => state.closeAgentModal);
  const closeArtifact = useAppStore((state) => state.closeArtifact);
  const closeConfirm = useAppStore((state) => state.closeConfirm);
  const theme = usePrefsStore((state) => state.theme);
  const reduceMotion = usePrefsStore((state) => state.reduceMotion);
  const [booted, setBooted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void init();
  }, [init]);

  useEffect(() => {
    applyAccent(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  const handleBootDone = useCallback(() => setBooted(true), []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'k') {
        event.preventDefault();
        if (ui.paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (mod && key === 'b') {
        if (ui.settingsOpen || ui.paletteOpen) return;
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && key === 'j') {
        if (view !== 'session' || !session) return;
        event.preventDefault();
        setCogOpen(!ui.cogOpen);
        return;
      }
      if (event.key === 'Escape') {
        if (run?.approval || run?.question) return;
        if (ui.confirm) {
          closeConfirm();
        } else if (ui.paletteOpen) {
          closePalette();
        } else if (ui.settingsOpen) {
          closeSettings();
        } else if (ui.agentModal.open) {
          closeAgentModal();
        } else if (ui.artifactId) {
          closeArtifact();
        } else if (ui.cogOpen && window.innerWidth < 1280) {
          setCogOpen(false);
        } else if (ui.sidebarOpen && window.innerWidth < 960) {
          setUI({ sidebarOpen: false });
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    closeAgentModal,
    closeArtifact,
    closeConfirm,
    closePalette,
    closeSettings,
    openPalette,
    run?.approval,
    run?.question,
    session,
    setCogOpen,
    setUI,
    toggleSidebar,
    ui.agentModal.open,
    ui.artifactId,
    ui.cogOpen,
    ui.confirm,
    ui.paletteOpen,
    ui.settingsOpen,
    view,
  ]);

  return (
    <SpeechProvider>
      <div className={cn('app-shell', !booted && initialized && 'app-shell--booting')}>
        <div className="app-ambient" aria-hidden="true">
          <span className="app-ambient__glow app-ambient__glow--one" />
          <span className="app-ambient__glow app-ambient__glow--two" />
          <span className="app-ambient__grid" />
          <span className="app-ambient__scan" />
        </div>

        <TopBar />

        <div className="app-body">
          <Sidebar />
          <div
            className={cn('sidebar-scrim', ui.sidebarOpen && 'is-visible')}
            onClick={() => setUI({ sidebarOpen: false })}
            aria-hidden="true"
          />
          <main className="workspace">
            {view === 'core' ? <CoreView /> : <ChatView />}
          </main>
          {view === 'session' && ui.cogOpen && (
            <>
              <div
                className="cog-scrim"
                onClick={() => setCogOpen(false)}
                aria-hidden="true"
              />
              <CognitionPanel />
            </>
          )}
        </div>

        {!booted && (
          <BootScreen
            state={bootState}
            error={bootError}
            onRetry={() => void retryInit()}
            onDone={handleBootDone}
          />
        )}

        <SettingsModal />
        <AgentModal />
        <ArtifactModal />
        <CommandPalette />
        <ApprovalModal />
        <QuestionModal />
        <ConfirmModal />
        <ToastViewport />

        <div className="sr-only" aria-live="polite">
          {run ? `Core status: ${STATUS_LABELS[run.status]}` : ''}
        </div>
      </div>
    </SpeechProvider>
  );
}
