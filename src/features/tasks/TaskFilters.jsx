'use client';

import { Search, X } from 'lucide-react';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import { TASK_TYPES, parseTaskKey, projectAnswersToKey } from '@/lib/work-items';
import { Button } from '@/components/ui/Button';

export const EMPTY_FILTERS = { q: '', status: '', priority: '', assigneeId: '', type: '', label: '' };

export function hasActiveFilters(filters) {
  return Object.values(filters).some(Boolean);
}

/**
 * Client-side filter matching, identical in meaning to GET /tasks filters (TM-F-040): the text
 * matches the title or description, or is the task's key (ALPHA-12). With `project`, a key the
 * project used before matches too, as on the server. `type` and `label` match exactly.
 */
export function applyFilters(tasks, filters, project) {
  const needle = filters.q.trim().toLowerCase();
  const key = parseTaskKey(filters.q);
  const keyMatches = (t) => Boolean(key) && t.number === key.number
    && (project ? projectAnswersToKey(project, key.projectKey) : (t.key || '').toUpperCase() === `${key.projectKey}-${key.number}`);
  return tasks.filter(
    (t) =>
      (!filters.status || t.status === filters.status) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.assigneeId || t.assigneeIds.includes(filters.assigneeId)) &&
      (!filters.type || (t.type || 'Task') === filters.type) &&
      (!filters.label || (t.labels || []).includes(filters.label)) &&
      (!needle || t.title.toLowerCase().includes(needle) || (t.description || '').toLowerCase().includes(needle) || keyMatches(t)),
  );
}

/** `labels` are the project's labels; the label filter shows when there are any. */
export function TaskFilters({ filters, onChange, members = [], labels = [], showStatus = true, resultCount }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  return (
    <div className="filters" role="search" aria-label="Filter tasks">
      <div className="input-with-icon">
        <Search size={16} aria-hidden="true" />
        <label htmlFor="task-search" className="visually-hidden">
          Search tasks
        </label>
        <input id="task-search" className="input" type="search" placeholder="Search tasks or keys" value={filters.q} onChange={set('q')} />
      </div>
      {showStatus ? (
        <select className="select" value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option>
          {TASK_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      ) : null}
      <select className="select" value={filters.priority} onChange={set('priority')} aria-label="Priority">
        <option value="">Any priority</option>
        {TASK_PRIORITIES.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <select className="select" value={filters.type} onChange={set('type')} aria-label="Type">
        <option value="">Any type</option>
        {TASK_TYPES.map((type) => (
          <option key={type}>{type}</option>
        ))}
      </select>
      {labels.length || filters.label ? (
        <select className="select" value={filters.label} onChange={set('label')} aria-label="Label">
          <option value="">Any label</option>
          {[...new Set([...labels, ...(filters.label ? [filters.label] : [])])].map((label) => (
            <option key={label}>{label}</option>
          ))}
        </select>
      ) : null}
      {members.length ? (
        <select className="select" value={filters.assigneeId} onChange={set('assigneeId')} aria-label="Assignee">
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : null}
      {hasActiveFilters(filters) ? (
        <Button variant="ghost" size="sm" className="filters-clear" onClick={() => onChange(EMPTY_FILTERS)}>
          <X size={14} /> Clear
        </Button>
      ) : null}
      {typeof resultCount === 'number' ? (
        <p className="filters-count" aria-live="polite">
          {resultCount} {resultCount === 1 ? 'task' : 'tasks'}
        </p>
      ) : null}
    </div>
  );
}
