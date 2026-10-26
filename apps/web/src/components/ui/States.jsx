import { AlertTriangle, Inbox } from 'lucide-react';
import { describeError } from '@/lib/api/errors';

export function Spinner({ label }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />;
}

export function Skeleton({ width = '100%', height = 14, radius, style }) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function EmptyState({ icon: Icon = Inbox, title, children, action, align, tone }) {
  return (
    <div className="state-block" data-align={align} data-tone={tone}>
      <span className="state-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, title = 'This did not load', onRetry, align }) {
  return (
    <div className="state-block" data-tone="error" data-align={align} role="alert">
      <span className="state-icon" aria-hidden="true">
        <AlertTriangle size={20} />
      </span>
      <h3>{title}</h3>
      <p>{describeError(error)}</p>
      {onRetry ? (
        <button type="button" className="btn" data-size="sm" onClick={onRetry}>
          <span className="btn-label">Try again</span>
        </button>
      ) : null}
    </div>
  );
}
