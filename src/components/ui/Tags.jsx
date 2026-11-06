import { CalendarClock, ChevronsUp, ChevronUp, Gauge, Globe, Lock, Minus } from 'lucide-react';
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
