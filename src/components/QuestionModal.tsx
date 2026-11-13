import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Modal } from './Modal';
import { useAppStore } from '../store/useAppStore';

export function QuestionModal() {
  const run = useAppStore((state) => state.run);
  const answerQuestion = useAppStore((state) => state.answerQuestion);
  const question = run?.question ?? null;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft('');
    setError(null);
    setBusy(false);
  }, [question?.id]);

  if (!question) return null;

  const submit = async (answer: string) => {
    const clean = answer.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await answerQuestion(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The core could not receive your answer.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Operator input required"
      subtitle={question.question}
      eyebrow="Core query"
      icon={<HelpCircle size={18} />}
      width={560}
      closeOnBackdrop={false}
      showClose={false}
      footer={
        <>
          <span className="modal__hint">The run is paused until you respond.</span>
          <button className="btn btn--primary" onClick={() => submit(draft)} disabled={!draft.trim() || busy}>
            {busy ? 'Transmitting…' : 'Send response'}
          </button>
        </>
      }
    >
      {question.options && question.options.length > 0 && (
        <div className="question__options">
          {question.options.map((option) => (
            <button
              key={option}
              className="question__option"
              onClick={() => submit(option)}
              disabled={busy}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span className="field__label">Response</span>
        <textarea
          className="textarea"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type your response to the core…"
          data-autofocus
          disabled={busy}
        />
      </label>
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
