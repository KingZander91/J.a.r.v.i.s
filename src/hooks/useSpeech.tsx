import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { stripMarkdownForSpeech } from '../lib/utils';
import { usePrefsStore } from '../store/prefsStore';

interface SpeechContextValue {
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  speakingId: string | null;
  speak: (text: string, id?: string) => void;
  cancel: () => void;
}

const SpeechContext = createContext<SpeechContextValue>({
  supported: false,
  voices: [],
  speakingId: null,
  speak: () => undefined,
  cancel: () => undefined,
});

export function SpeechProvider({ children }: { children: ReactNode }) {
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, [supported]);

  const speak = useCallback(
    (text: string, id?: string) => {
      if (!supported) return;
      const clean = stripMarkdownForSpeech(text).slice(0, 12_000);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      const { voiceURI } = usePrefsStore.getState();
      const voice = voices.find((item) => item.voiceURI === voiceURI);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.03;
      utterance.pitch = 0.92;
      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);
      utteranceRef.current = utterance;
      setSpeakingId(id ?? 'utterance');
      window.speechSynthesis.speak(utterance);
    },
    [supported, voices],
  );

  const value = useMemo(
    () => ({ supported, voices, speakingId, speak, cancel }),
    [supported, voices, speakingId, speak, cancel],
  );

  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>;
}

export function useSpeech(): SpeechContextValue {
  return useContext(SpeechContext);
}
