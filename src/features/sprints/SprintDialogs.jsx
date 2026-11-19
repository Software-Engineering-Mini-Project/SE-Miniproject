'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, describeError } from '@/lib/api/errors';
import { SPRINT_GOAL_MAX, SPRINT_NAME_MAX, readSprintFields, sprintTotals } from '@/lib/sprints';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function FormAlert({ message }) {
  if (!message) return null;
  return (
    <p className="form-alert" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      {message}
    </p>
  );
}

/** Create a sprint (with suggested name and dates) or edit one. `onSubmit` gets the changed fields. */
export function SprintFormDialog({ open, onOpenChange, sprint = null, defaults, onSubmit }) {
  if (!open) return null;
  return <SprintFormContent onOpenChange={onOpenChange} sprint={sprint} defaults={defaults} onSubmit={onSubmit} />;
}

function SprintFormContent({ onOpenChange, sprint, defaults, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: sprint?.name ?? defaults?.name ?? '',
    goal: sprint?.goal ?? '',
    startDate: sprint?.startDate ?? defaults?.startDate ?? '',
    endDate: sprint?.endDate ?? defaults?.endDate ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    // The same rules the API applies (src/lib/sprints.js), so most mistakes never leave the form.
    const { values: input, errors: problems } = readSprintFields(values, { create: true });
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(input);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setFormError(describeError(error));
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={onOpenChange} title={sprint ? 'Edit sprint' : 'New sprint'} description={sprint ? undefined : 'Plan tasks into it from the backlog, then start it when the team is ready.'}>
      <form className="task-form" noValidate onSubmit={handleSubmit}>
        <FormAlert message={formError} />
        <Field label="Name" error={errors.name}>
          <input className="input" value={values.name} maxLength={SPRINT_NAME_MAX + 10} onChange={set('name')} autoFocus />
        </Field>
        <div className="sprint-form-dates">
          <Field label="Starts" error={errors.startDate}>
            <input className="input" type="date" value={values.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="Ends" error={errors.endDate}>
            <input className="input" type="date" value={values.endDate} min={values.startDate || undefined} onChange={set('endDate')} />
          </Field>
        </div>
        <Field label="Sprint goal" hint="Optional. What the team wants to have done by the end." error={errors.goal}>
          <textarea className="textarea" rows={3} maxLength={SPRINT_GOAL_MAX + 10} value={values.goal} onChange={set('goal')} />
        </Field>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {sprint ? 'Save changes' : 'Create sprint'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Completing the active sprint: says what was finished, and asks where unfinished work goes
 * (the backlog or a planned sprint). Finished work stays with the sprint as its record.
 */
export function CompleteSprintDialog({ sprint, tasks, plannedSprints, onOpenChange, onComplete }) {
  if (!sprint) return null;
  return <CompleteSprintContent sprint={sprint} tasks={tasks} plannedSprints={plannedSprints} onOpenChange={onOpenChange} onComplete={onComplete} />;
}

function CompleteSprintContent({ sprint, tasks, plannedSprints, onOpenChange, onComplete }) {
  const [moveTo, setMoveTo] = useState('backlog');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const totals = sprintTotals(tasks);
  const unfinished = totals.count - totals.done;

  async function complete() {
    setSaving(true);
    setFormError(null);
    try {
      await onComplete(moveTo);
      onOpenChange(false);
    } catch (error) {
      setFormError(describeError(error));
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={onOpenChange} title={`Complete ${sprint.name}?`} description="Finished work stays with this sprint as its record.">
      <div className="task-form">
        <FormAlert message={formError} />
        <p className="sprint-complete-summary">
          {plural(totals.done, 'item')} of {totals.count} finished
          {totals.points ? `, ${totals.donePoints} of ${plural(totals.points, 'point')}` : ''}.
        </p>
        {unfinished ? (
          <fieldset className="visibility-options">
            <legend>Move the {plural(unfinished, 'unfinished item')} to</legend>
            {[['backlog', 'The backlog'], ...plannedSprints.map((item) => [item.id, item.name])].map(([value, label]) => (
              <label key={value} className="visibility-option">
                <input type="radio" name="moveTo" value={value} checked={moveTo === value} onChange={() => setMoveTo(value)} />
                <span>
                  <strong>{label}</strong>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="muted">Everything in this sprint is done.</p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Keep it running
          </Button>
          <Button variant="primary" loading={saving} onClick={complete}>
            Complete sprint
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Deleting a planned sprint: its tasks go back to the backlog. */
export function DeleteSprintDialog({ sprint, count, onOpenChange, onDelete }) {
  const [saving, setSaving] = useState(false);
  if (!sprint) return null;
  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="Delete this sprint?"
      description={count ? `Its ${plural(count, 'task')} go back to the backlog. Nothing else is deleted.` : 'It has no tasks. Nothing else is deleted.'}
    >
      <p className="confirm-subject">{sprint.name}</p>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Keep sprint
        </Button>
        <Button
          variant="danger"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onDelete();
              onOpenChange(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          Delete sprint
        </Button>
      </div>
    </Modal>
  );
}
