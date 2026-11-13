import { Check, Circle, Loader2, Minus, X } from 'lucide-react';
import type { PlanTask } from '../../shared/types';
import { cn } from '../lib/utils';

interface PlanListProps {
  tasks: PlanTask[];
  compact?: boolean;
  className?: string;
}

function PlanIcon({ status }: { status: PlanTask['status'] }) {
  if (status === 'done') return <Check size={12} strokeWidth={2.4} />;
  if (status === 'in_progress') return <Loader2 size={12} className="spin" />;
  if (status === 'failed') return <X size={12} />;
  if (status === 'skipped') return <Minus size={12} />;
  return <Circle size={9} />;
}

export function PlanList({ tasks, compact, className }: PlanListProps) {
  if (!tasks.length) return null;
  const done = tasks.filter((task) => task.status === 'done').length;
  const progress = Math.round((done / tasks.length) * 100);

  return (
    <div className={cn('plan', compact && 'plan--compact', className)}>
      <div className="plan__head">
        <span className="eyebrow">Mission plan</span>
        <span className="plan__count">
          {String(done).padStart(2, '0')} / {String(tasks.length).padStart(2, '0')}
        </span>
      </div>
      <div className="plan__bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="plan__list">
        {tasks.map((task) => (
          <li key={task.id} className={`plan__row plan__row--${task.status}`}>
            <span className="plan__icon">
              <PlanIcon status={task.status} />
            </span>
            <span className="plan__title">{task.title}</span>
            {task.note && <span className="plan__note">{task.note}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
