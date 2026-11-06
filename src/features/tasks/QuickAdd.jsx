'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { AtSign, CalendarClock, CornerDownLeft, Flag, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { localToday } from '@/lib/dates';
import { formatDue } from '@/lib/format';
import { parseQuickAdd } from '@/lib/quick-add';
import { LIMITS } from '@/lib/constants';

const ICONS = { priority: Flag, due: CalendarClock, assignee: AtSign };

function partLabel(part) {
  if (part.kind === 'priority') return `${part.value} priority`;
  if (part.kind === 'due') return formatDue(part.value);
  return part.label;
}

/**
 * One-line task entry for a project (src/lib/quick-add.js): "Ship the release fri !high @mina".
 * Shows what it understood before anything is created, and lets each piece be kept as text.
 */
export function QuickAdd({ projectId, members, currentUserId, onCreated }) {
  const id = useId();
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const parsed = useMemo(
    () => parseQuickAdd(text, { today: localToday(), members, currentUserId, keep }),
    [text, members, currentUserId, keep],
  );
  const hasDetails = parsed.parts.length > 0 || parsed.unknownHandles.length > 0;

  async function submit(event) {
    event.preventDefault();
    if (saving || !text.trim()) return;
    if (!parsed.title) {
      setError('Add a title as well as the details.');
      return;
    }
    if (parsed.title.length > LIMITS.taskTitleMax) {
      setError(`Keep the title to ${LIMITS.taskTitleMax} characters or fewer.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.tasks.create(projectId, {
        title: parsed.title,
        status: 'To Do',
        priority: parsed.priority || 'Medium',
        dueDate: parsed.dueDate,
        assigneeIds: parsed.assigneeIds,
      });
      setText('');
      setKeep(new Set());
      onCreated(created);
    } catch (failure) {
      setError(describeError(failure));
      toast.error(describeError(failure));
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form className="quick-add" onSubmit={submit} data-busy={saving || undefined}>
      <label htmlFor={`${id}-input`} className="visually-hidden">
        Quick add a task
      </label>
      <div className="quick-add-field">
        <Plus size={16} aria-hidden="true" className="quick-add-icon" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="quick-add-input"
          value={text}
          placeholder="Add a task… e.g. Draft the release notes fri !high @me"
          autoComplete="off"
          spellCheck="false"
          maxLength={LIMITS.taskTitleMax + 120}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && text) {
              event.stopPropagation();
              setText('');
              setKeep(new Set());
            }
          }}
        />
        <button type="submit" className="quick-add-submit" disabled={saving || !text.trim()} aria-label="Add task">
          <CornerDownLeft size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="quick-add-preview" aria-live="polite">
        {hasDetails ? (
          <>
            {parsed.parts.map((part) => {
              const Icon = ICONS[part.kind];
              return (
                <span key={`${part.kind}:${part.text}`} className="quick-chip" data-kind={part.kind}>
                  <Icon size={13} aria-hidden="true" />
                  {partLabel(part)}
                  <button
                    type="button"
                    className="quick-chip-keep"
                    aria-label={`Keep "${part.text}" as text`}
                    title={`Keep "${part.text}" as text`}
                    onClick={() => setKeep((current) => new Set(current).add(part.text))}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              );
            })}
            {parsed.unknownHandles.map((handle) => (
              <span key={handle} className="quick-chip" data-kind="unknown">
                No assignable member matches {handle}
              </span>
            ))}
          </>
        ) : null}
        <span id={`${id}-help`} className="quick-add-help" hidden={hasDetails}>
          <kbd>!high</kbd> priority · <kbd>@name</kbd> assign · <kbd>tomorrow</kbd>, <kbd>fri</kbd>, <kbd>nov 20</kbd>, <kbd>in 3 days</kbd> due
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="quick-add-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
