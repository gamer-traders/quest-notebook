import type { ReactNode } from 'react';

export type OutcomeTone = 'locked' | 'waiting' | 'good' | 'bad' | 'neutral';

export function Outcome({ tone, title, children }: { tone: OutcomeTone; title: string; children?: ReactNode }) {
  return (
    <div className={`outcome tone-${tone}`} role="status">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
