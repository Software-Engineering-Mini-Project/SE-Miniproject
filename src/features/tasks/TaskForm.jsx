'use client';

import { useId, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { LABELS_PER_TASK, STORY_POINTS, TASK_TYPES, labelError, normalizeLabel } from '@/lib/work-items';
import { useWorkItems } from './work-item-context';

const empty = { title: '', description: '', status: 'To Do', priority: 'Medium', dueDate: '', assigneeIds: [], type: 'Task', storyPoints: null, labels: [], epicId: null };

/**
 * Labels as removable chips plus a text box: Enter, a comma or leaving the box adds what was
 * typed. `suggestions` (the project's labels) appear as you type.
 */
function LabelInput({ labels, suggestions, error, onChange, onError }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const label = normalizeLabel(draft);
    if (!label) {
      setDraft('');
      return;
    }
    const full = labels.length >= LABELS_PER_TASK && !labels.includes(label);
    const problem = labelError(label) || (full ? `A task can have at most ${LABELS_PER_TASK} labels.` : null);
    if (problem) {
      onError(problem);
      return;
    }
    if (!labels.includes(label)) onChange([...labels, label]);
    setDraft('');
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-input`}>
        Labels
      </label>
      <div className="label-input" data-invalid={error ? true : undefined}>
        {labels.map((label) => (
          <span key={label} className="label-chip label-chip-removable">
            {label}
            <button type="button" aria-label={`Remove label ${label}`} onClick={() => onChange(labels.filter((l) => l !== label))}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={`${id}-input`}
          className="label-input-text"
          value={draft}
          list={`${id}-suggestions`}
          placeholder={labels.length ? '' : 'e.g. frontend'}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          onChange={(event) => {
            if (error) onError(undefined);
            setDraft(event.target.value.replace(/,$/, ''));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add();
            } else if (event.key === 'Backspace' && !draft && labels.length) {
              onChange(labels.slice(0, -1));
            }
          }}
          onBlur={add}
        />
        <datalist id={`${id}-suggestions`}>
          {suggestions.filter((label) => !labels.includes(label)).map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        <p className="field-hint" id={`${id}-hint`}>
          Press Enter after each label. Labels belong to this project.
        </p>
      )}
    </div>
  );
}

/**
 * Create/edit task form (TM-F-010, TM-F-011, TM-F-022). `onSubmit` receives the payload and
 * should throw ApiError on failure; field errors from the API are shown inline.
 */
export function TaskForm({ initial, members, submitLabel = 'Save task', onSubmit, onCancel }) {
  const [values, setValues] = useState(() => ({ ...empty, ...initial, dueDate: initial?.dueDate || '' }));
  const workItems = useWorkItems();
  // An epic can hold any other item, but never itself or another epic.
  const epicChoices = workItems.epics.filter((epic) => epic.id !== initial?.id);
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
        type: values.type,
        storyPoints: values.storyPoints,
        labels: values.labels,
        epicId: values.type === 'Epic' ? null : values.epicId || null,
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
      <div className="task-form-row">
        <Field label="Type" error={errors.type}>
          <select className="select" value={values.type} onChange={(e) => set('type', e.target.value)}>
            {TASK_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </Field>
        <Field label="Story points" error={errors.storyPoints}>
          <select className="select" value={values.storyPoints ?? ''} onChange={(e) => set('storyPoints', e.target.value ? Number(e.target.value) : null)}>
            <option value="">No estimate</option>
            {STORY_POINTS.map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
        </Field>
        {values.type === 'Epic' ? (
          <Field label="Epic" hint="An epic cannot belong to another epic.">
            <select className="select" value="" disabled>
              <option value="">None</option>
            </select>
          </Field>
        ) : (
          <Field label="Epic" error={errors.epicId}>
            <select className="select" value={values.epicId || ''} onChange={(e) => set('epicId', e.target.value || null)}>
              <option value="">None</option>
              {epicChoices.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.key ? `${epic.key} ${epic.title}` : epic.title}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <LabelInput
        labels={values.labels}
        suggestions={workItems.labels}
        error={errors.labels}
        onChange={(labels) => set('labels', labels)}
        onError={(message) => setErrors((e) => ({ ...e, labels: message }))}
      />
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
