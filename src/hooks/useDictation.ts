import { useCallback, useEffect, useRef, useState } from 'react';

interface RecognitionResult {
  readonly isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface RecognitionErrorEvent {
  error: string;
}

interface RecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionInstance;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const candidate =
    (window as unknown as { SpeechRecognition?: RecognitionCtor })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: RecognitionCtor })
      .webkitSpeechRecognition;
  return candidate ?? null;
}

export function useDictation(onText: (text: string) => void) {
  const [supported] = useState(() => Boolean(getRecognitionCtor()));
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    try {
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        let full = '';
        for (let index = 0; index < event.results.length; index += 1) {
          full += event.results[index][0]?.transcript ?? '';
        }
        onTextRef.current(full.trim());
      };
      recognition.onerror = () => {
        setListening(false);
      };
      recognition.onend = () => {
        setListening(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, stop]);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
    },
    [],
  );

  return { supported, listening, start, stop };
}
