'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

const empty = { title: '', description: '', status: 'To Do', priority: 'Medium', dueDate: '', assigneeIds: [] };

/**
 * Create/edit task form (TM-F-010, TM-F-011, TM-F-022). `onSubmit` receives the payload and
 * should throw ApiError on failure; field errors from the API are shown inline.
 */
export function TaskForm({ initial, members, submitLabel = 'Save task', onSubmit, onCancel }) {
  const [values, setValues] = useState(() => ({ ...empty, ...initial, dueDate: initial?.dueDate || '' }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleAssignee = (id) =>
    set('assigneeIds', values.assigneeIds.includes(id) ? values.assigneeIds.filter((a) => a !== id) : [...values.assigneeIds, id]);

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!values.title.trim()) nextErrors.title = 'Give the task a title.';
    else if (values.title.trim().length > LIMITS.taskTitleMax) nextErrors.title = `Use ${LIMITS.taskTitleMax} characters or fewer.`;
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      await onSubmit({
        title: values.title.trim(),
        description: values.description.trim(),
        status: values.status,
        priority: values.priority,
        dueDate: values.dueDate || null,
        assigneeIds: values.assigneeIds,
      });
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setFormError(describeError(error));
      setSaving(false);
    }
  }

  return (
    <form className="task-form" noValidate onSubmit={handleSubmit}>
      {formError ? (
        <p className="form-alert" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {formError}
        </p>
      ) : null}
      <Field label="Title" error={errors.title}>
        <input className="input" value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={LIMITS.taskTitleMax + 20} autoFocus />
      </Field>
      <Field label="Description" error={errors.description} hint="Optional">
        <textarea className="textarea" rows={3} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="task-form-row">
        <Field label="Status" error={errors.status}>
          <select className="select" value={values.status} onChange={(e) => set('status', e.target.value)}>
            {TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" error={errors.priority}>
          <select className="select" value={values.priority} onChange={(e) => set('priority', e.target.value)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Due date" error={errors.dueDate}>
          <input className="input" type="date" value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>
      <fieldset className="assignee-picker" aria-describedby={errors.assigneeIds ? 'assignee-error' : undefined}>
        <legend className="field-label">Assignees</legend>
        <p className="field-hint">Only project members can be assigned. Each new assignee gets a notification.</p>
        <div className="assignee-options">
          {members.map((member) => {
            const checked = values.assigneeIds.includes(member.id);
            return (
              <label key={member.id} className="assignee-option" data-checked={checked || undefined}>
                <input type="checkbox" checked={checked} onChange={() => toggleAssignee(member.id)} />
                <Avatar user={member} size="sm" />
                <span className="assignee-name">{member.name}</span>
              </label>
            );
          })}
        </div>
        {errors.assigneeIds ? (
          <p className="field-error" id="assignee-error">
            {errors.assigneeIds}
          </p>
        ) : null}
      </fieldset>
      <div className="dialog-actions">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
