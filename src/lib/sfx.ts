import { usePrefsStore } from '../store/prefsStore';

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!context) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') {
    void context.resume();
  }
  return context;
}

interface ToneOptions {
  frequency: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  sweep?: number;
}

function tone({ frequency, duration = 0.08, type = 'sine', gain = 0.035, delay = 0, sweep }: ToneOptions): void {
  if (!usePrefsStore.getState().sound) return;
  const ctx = getContext();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const amplifier = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (sweep) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), start + duration);
  }
  amplifier.gain.setValueAtTime(0, start);
  amplifier.gain.linearRampToValueAtTime(gain, start + 0.008);
  amplifier.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(amplifier);
  amplifier.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export const sfx = {
  send: () => {
    tone({ frequency: 520, duration: 0.06, type: 'triangle', gain: 0.028 });
    tone({ frequency: 780, duration: 0.09, type: 'triangle', gain: 0.02, delay: 0.05 });
  },
  receive: () => {
    tone({ frequency: 660, duration: 0.1, type: 'sine', gain: 0.024 });
  },
  tool: () => {
    tone({ frequency: 420, duration: 0.045, type: 'square', gain: 0.012 });
  },
  success: () => {
    tone({ frequency: 620, duration: 0.08, type: 'sine', gain: 0.028 });
    tone({ frequency: 930, duration: 0.12, type: 'sine', gain: 0.022, delay: 0.07 });
  },
  approval: () => {
    tone({ frequency: 300, duration: 0.12, type: 'triangle', gain: 0.035 });
    tone({ frequency: 300, duration: 0.12, type: 'triangle', gain: 0.03, delay: 0.16 });
  },
  error: () => {
    tone({ frequency: 220, duration: 0.18, type: 'sawtooth', gain: 0.022, sweep: 120 });
  },
  click: () => {
    tone({ frequency: 720, duration: 0.03, type: 'sine', gain: 0.014 });
  },
};
