import { CalendarClock, ChevronsUp, ChevronUp, Minus } from 'lucide-react';
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
