'use client';

import { Search, X } from 'lucide-react';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import { Button } from '@/components/ui/Button';

export const EMPTY_FILTERS = { q: '', status: '', priority: '', assigneeId: '' };

export function hasActiveFilters(filters) {
  return Object.values(filters).some(Boolean);
}

/** Client-side filter matching, identical in meaning to GET /tasks filters (TM-F-040). */
export function applyFilters(tasks, filters) {
  const needle = filters.q.trim().toLowerCase();
  return tasks.filter(
    (t) =>
      (!filters.status || t.status === filters.status) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.assigneeId || t.assigneeIds.includes(filters.assigneeId)) &&
      (!needle || t.title.toLowerCase().includes(needle) || (t.description || '').toLowerCase().includes(needle)),
  );
}

export function TaskFilters({ filters, onChange, members = [], showStatus = true, resultCount }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  return (
    <div className="filters" role="search" aria-label="Filter tasks">
      <div className="input-with-icon">
        <Search size={16} aria-hidden="true" />
        <label htmlFor="task-search" className="visually-hidden">
          Search tasks
        </label>
        <input id="task-search" className="input" type="search" placeholder="Search tasks" value={filters.q} onChange={set('q')} />
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
