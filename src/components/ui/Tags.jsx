import { Bookmark, Bug, CalendarClock, ChevronsUp, ChevronUp, Gauge, Globe, Lock, Minus, SquareCheckBig, Zap } from 'lucide-react';
import { PRIORITY_META, STATUS_META } from '@/lib/constants';
import { daysUntil, formatDue, isOverdue } from '@/lib/format';

export function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META['To Do'];
  return (
    <span className="status-chip" data-status={meta.key}>
      {meta.label}
    </span>
  );
}

const PRIORITY_ICON = { High: ChevronsUp, Medium: ChevronUp, Low: Minus };

export function PriorityTag({ priority }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.Medium;
  const Icon = PRIORITY_ICON[priority] || ChevronUp;
  return (
    <span className="priority-tag" data-priority={meta.key}>
      <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
      {meta.label}
      <span className="visually-hidden"> priority</span>
    </span>
  );
}

const RISK_LABEL = { 'at-risk': 'At risk', tight: 'Tight' };

/**
 * Forecast flag for a task whose due date the delivery forecast doubts (src/lib/forecast.js).
 * On-track tasks show nothing, so the flag stays rare enough to mean something.
 */
export function RiskTag({ risk }) {
  if (!risk || !RISK_LABEL[risk.level]) return null;
  const percent = Math.round(risk.probability * 100);
  return (
    <span className="risk-tag" data-level={risk.level} title={`Forecast: ${percent}% chance of finishing by the due date`}>
      <Gauge size={13} aria-hidden="true" />
      {RISK_LABEL[risk.level]}
      <span className="visually-hidden">: {percent}% chance of finishing by the due date</span>
    </span>
  );
}

export function DueTag({ task }) {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task);
  const days = daysUntil(task.dueDate);
  const soon = !overdue && task.status !== 'Done' && days !== null && days <= 1;
  const label = task.status === 'Done' ? `Due ${formatDue(task.dueDate).replace(/^Due /, '').replace(/ overdue$/, ' ago')}` : formatDue(task.dueDate);
  return (
    <span className="due-tag" data-tone={overdue ? 'overdue' : soon ? 'soon' : undefined}>
      <CalendarClock size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

/** A task's work-item key (ALPHA-12), set in monospace so keys line up in lists. */
export function TaskKey({ value }) {
  if (!value) return null;
  return <span className="task-key">{value}</span>;
}

const TYPE_ICON = { Task: SquareCheckBig, Bug, Story: Bookmark, Epic: Zap };

/**
 * A work item's type as its icon; the name is in the tooltip and for screen readers, or shown
 * with `showLabel`.
 */
export function TypeIcon({ type, showLabel = false }) {
  const name = TYPE_ICON[type] ? type : 'Task';
  const Icon = TYPE_ICON[name];
  return (
    <span className="type-icon" data-type={name.toLowerCase()} title={showLabel ? undefined : name}>
      <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
      {showLabel ? <span className="type-icon-name">{name}</span> : <span className="visually-hidden">{name}</span>}
    </span>
  );
}

/** A story-point estimate as a small round badge; nothing when there is no estimate. */
export function PointsBadge({ points }) {
  if (!points) return null;
  return (
    <span className="points-badge" title={`${points} story ${points === 1 ? 'point' : 'points'}`}>
      <span aria-hidden="true">{points}</span>
      <span className="visually-hidden">{points} story {points === 1 ? 'point' : 'points'}</span>
    </span>
  );
}

/** Labels as quiet chips; past `max`, the rest collapse into "+2". */
export function LabelList({ labels, max = Infinity }) {
  if (!labels?.length) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.length - shown.length;
  return (
    <ul className="label-list" aria-label="Labels">
      {shown.map((label) => (
        <li key={label} className="label-chip">
          {label}
        </li>
      ))}
      {hidden > 0 ? (
        <li className="label-chip" data-more title={labels.slice(max).join(', ')}>
          +{hidden}
          <span className="visually-hidden"> more: {labels.slice(max).join(', ')}</span>
        </li>
      ) : null}
    </ul>
  );
}

/** How far an epic is: a thin bar and "3/5 done", from epicProgress() in src/lib/work-items.js. */
export function EpicProgress({ progress, compact = false }) {
  if (!progress) return null;
  const text = progress.total ? `${progress.done}/${progress.total} done` : 'No items yet';
  return (
    <div className="epic-progress" data-compact={compact || undefined}>
      <div
        className="epic-progress-bar"
        role="progressbar"
        aria-label="Epic progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={`${text}${progress.points ? `, ${progress.donePoints} of ${progress.points} points` : ''}`}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="epic-progress-text tabular">
        {text}
        {!compact && progress.points ? ` · ${progress.donePoints}/${progress.points} pts` : null}
      </span>
    </div>
  );
}

/** Private (invite only) or Open (anyone in the workspace can join). */
export function VisibilityBadge({ visibility }) {
  const open = visibility === 'open';
  const Icon = open ? Globe : Lock;
  return (
    <span className="visibility-badge" data-visibility={open ? 'open' : 'private'}>
      <Icon size={12} aria-hidden="true" />
      {open ? 'Open' : 'Private'}
    </span>
  );
}
