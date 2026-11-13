import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccentId } from '../../shared/types';

interface PrefsState {
  theme: AccentId;
  sound: boolean;
  reduceMotion: boolean;
  tts: boolean;
  autoSpeak: boolean;
  voiceURI: string;
  setTheme: (theme: AccentId) => void;
  setSound: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;
  setTts: (enabled: boolean) => void;
  setAutoSpeak: (enabled: boolean) => void;
  setVoiceURI: (voice: string) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'teal',
      sound: true,
      reduceMotion: false,
      tts: false,
      autoSpeak: true,
      voiceURI: '',
      setTheme: (theme) => set({ theme }),
      setSound: (sound) => set({ sound }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setTts: (tts) => set({ tts }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setVoiceURI: (voiceURI) => set({ voiceURI }),
    }),
    { name: 'jarvis.prefs.v1' },
  ),
);
