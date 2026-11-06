'use client';

import { useId, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';

/** "2 of 5" progress for a checklist, or null when there is none. */
export function checklistProgress(checklist) {
  if (!checklist?.length) return null;
  return { done: checklist.filter((item) => item.done).length, total: checklist.length };
}

/**
 * A task's checklist in the task sheet. `canTick` ticks items off (task.status); `canEdit` also adds,
 * renames and removes them (task.edit). Viewers get neither. Ticks show at once and roll back if the API refuses.
 * `onChange(checklist, updatedAt?)` keeps the parent's task list in step.
 */
export function Checklist({ task, canTick, canEdit, onChange }) {
  const titleId = useId();
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const items = task.checklist || [];
  const progress = checklistProgress(items);
  const full = items.length >= LIMITS.checklistItems;

  if (!items.length && !canEdit) return null;

  async function toggle(item) {
    const before = items;
    onChange(items.map((entry) => (entry.id === item.id ? { ...entry, done: !item.done } : entry)));
    try {
      const result = await api.checklist.update(task.id, item.id, { done: !item.done });
      onChange(result.checklist, result.updatedAt);
    } catch (error) {
      onChange(before);
      toast.error(describeError(error));
    }
  }

  async function remove(item) {
    const before = items;
    onChange(items.filter((entry) => entry.id !== item.id));
    try {
      const result = await api.checklist.remove(task.id, item.id);
      onChange(result.checklist, result.updatedAt);
    } catch (error) {
      onChange(before);
      toast.error(describeError(error));
    }
  }

  async function add(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || adding) return;
    setAdding(true);
    try {
      const result = await api.checklist.add(task.id, value);
      onChange(result.checklist, result.updatedAt);
      setText('');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setAdding(false);
      // Stay in the field so a list can be typed one item after another.
      inputRef.current?.focus();
    }
  }

  return (
    <section className="checklist" aria-labelledby={titleId}>
      <div className="checklist-head">
        <h3 id={titleId} className="sheet-section-title">
          Checklist
        </h3>
        {progress ? (
          <span className="checklist-progress-text tabular">
            {progress.done} of {progress.total} done
          </span>
        ) : null}
      </div>
      {progress ? (
        <div className="checklist-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress.done / progress.total})` }} />
        </div>
      ) : null}

      {items.length ? (
        <ul className="checklist-items">
          {items.map((item) => (
            <li key={item.id} className="checklist-item" data-done={item.done || undefined}>
              <label className="checklist-check">
                <input type="checkbox" checked={item.done} disabled={!canTick} onChange={() => toggle(item)} />
                <span className="checklist-box" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="checklist-text">{item.text}</span>
              </label>
              {canEdit ? (
                <button type="button" className="checklist-remove" aria-label={`Remove "${item.text}"`} onClick={() => remove(item)}>
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        full ? (
          <p className="checklist-note">A task can have at most {LIMITS.checklistItems} checklist items.</p>
        ) : (
          <form className="checklist-add" onSubmit={add}>
            <label htmlFor={`${titleId}-add`} className="visually-hidden">
              Add a checklist item
            </label>
            <input
              ref={inputRef}
              id={`${titleId}-add`}
              className="input"
              value={text}
              maxLength={LIMITS.checklistItemMax}
              placeholder="Add an item"
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
            />
            <Button type="submit" size="sm" loading={adding} disabled={!text.trim()}>
              <Plus size={14} /> Add
            </Button>
          </form>
        )
      ) : null}
    </section>
  );
}
