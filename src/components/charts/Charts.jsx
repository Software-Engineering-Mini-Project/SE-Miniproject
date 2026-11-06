// Small, dependency-free chart pieces in plain HTML/CSS. Every chart prints its numbers as text
// (or offers a table), so nothing is conveyed by color or hover alone.

import { TASK_STATUSES } from '@/lib/constants';
import { plural } from '@/lib/format';
import './charts.css';

export const statusKey = (status) => status.toLowerCase().replace(' ', '-');

/** Swatch + name for each task status, in board order. One legend per chart or table. */
export function StatusLegend({ className }) {
  return (
    <ul className={className ? `chart-legend ${className}` : 'chart-legend'} aria-label="Legend">
      {TASK_STATUSES.map((status) => (
        <li key={status}>
          <span className="chart-swatch" data-status={statusKey(status)} aria-hidden="true" />
          {status}
        </li>
      ))}
    </ul>
  );
}

/**
 * One series of counts as horizontal bars on a shared baseline, value printed at each tip.
 * `tone: 'danger'` marks a status bucket (e.g. overdue); everything else uses the accent.
 * @param {{ items: { key: string, label: string, count: number, tone?: 'danger' }[], label: string, unit?: string }} props
 */
export function BarList({ items, label, unit = 'task' }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="bar-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="bar-row" title={`${item.label}: ${plural(item.count, unit)}`}>
          <span className="bar-label">{item.label}</span>
          <span className="bar-track" aria-hidden="true">
            {item.count ? <span className="bar-fill" data-tone={item.tone} style={{ width: `${(item.count / max) * 100}%` }} /> : null}
          </span>
          <span className="bar-value">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Thin status split for one whole; the caller prints the figures beside it. */
export function StatusBar({ counts, total, className }) {
  const whole = total || TASK_STATUSES.reduce((sum, status) => sum + (counts[status] || 0), 0);
  return (
    <span className={className ? `status-bar ${className}` : 'status-bar'} aria-hidden="true">
      {whole
        ? TASK_STATUSES.map((status) => (counts[status] ? (
            <span key={status} data-status={statusKey(status)} style={{ flexGrow: counts[status] / whole }} />
          ) : null))
        : null}
    </span>
  );
}

/** Text twin of a status split, for screen readers. */
export function statusSummary(counts) {
  return TASK_STATUSES.map((status) => `${status} ${counts[status] || 0}`).join(', ');
}

/**
 * Several wholes on one shared axis: one stacked bar per row (e.g. per member), longest = `max`.
 * @param {{ rows: { id: string, name: string, counts: Record<string, number>, total: number, overdue?: number }[], label: string }} props
 */
export function StackedBars({ rows, label }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <ul className="stack-list" aria-label={label}>
      {rows.map((row) => (
        <li key={row.id} className="stack-row">
          <span className="stack-name" title={row.name}>
            {row.name}
          </span>
          <span className="stack-track" aria-hidden="true">
            <span className="stack-bar" style={{ width: `${(row.total / max) * 100}%` }}>
              {TASK_STATUSES.map((status) => (row.counts[status] ? (
                <span
                  key={status}
                  className="stack-part"
                  data-status={statusKey(status)}
                  style={{ flexGrow: row.counts[status] }}
                  title={`${row.name}: ${status} ${row.counts[status]}`}
                />
              ) : null))}
            </span>
          </span>
          <span className="stack-value">
            {plural(row.total, 'task')}
            {row.overdue ? <strong> · {row.overdue} overdue</strong> : null}
            <span className="visually-hidden">: {statusSummary(row.counts)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
