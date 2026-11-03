import type { ReactNode } from 'react';

export function LoadingCard({ lines = 3, height = 14 }: { lines?: number; height?: number }) {
  return (
    <div className="vstack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="grid" aria-busy="true">
      <span className="visually-hidden">Loading dashboard…</span>
      <div className="grid grid-stats">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="card" key={i}>
            <div className="skeleton" style={{ height: 12, width: '55%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 28, width: '75%' }} />
          </div>
        ))}
      </div>
      <div className="grid grid-charts">
        <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
        <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions?: ReactNode;
}) {
  return (
    <div className="state">
      <h3>{title}</h3>
      <p>{message}</p>
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && (
        <div className="state-actions">
          <button className="btn" onClick={onRetry}>Try again</button>
        </div>
      )}
    </div>
  );
}

export function Banner({
  kind = 'info',
  children,
  onDismiss,
}: {
  kind?: 'info' | 'error' | 'warn';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onDismiss && (
        <button className="btn btn-sm" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}
