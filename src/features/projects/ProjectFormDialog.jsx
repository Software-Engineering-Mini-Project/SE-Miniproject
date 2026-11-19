'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Globe, Lock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { PROJECT_VISIBILITY_SUMMARY } from '@/lib/permissions';
import { PROJECT_KEY_MAX, normalizeProjectKey, projectKeyError, suggestProjectKey } from '@/lib/work-items';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';

/**
 * Create or edit a project (TM-F-020), including who can find it (Private or Open) and its
 * work-item key (tasks read as ALPHA-12). On create the key follows the name until someone edits
 * it; on edit only the owner (or an admin) can change it, which `canEditKey` says.
 */
export function ProjectFormDialog({ open, onOpenChange, project, canEditKey = true, onSubmit }) {
  if (!open) return null;
  return <ProjectFormDialogContent onOpenChange={onOpenChange} project={project} canEditKey={canEditKey} onSubmit={onSubmit} />;
}

function ProjectFormDialogContent({ onOpenChange, project, canEditKey, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: project?.name || '',
    description: project?.description || '',
    visibility: project?.visibility || 'private',
    key: project?.key || '',
  }));
  // On create, the key is suggested from the name until the person types their own.
  const [keyTouched, setKeyTouched] = useState(Boolean(project));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Ask the server for a free key (it knows which keys the organisation already uses). The name
  // field sets a local suggestion as you type, so the key never lags behind the name.
  useEffect(() => {
    if (keyTouched) return undefined;
    const name = values.name.trim();
    if (!name) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.projects.suggestKey(name).then(
        ({ key }) => !cancelled && setValues((v) => (v.name.trim() === name ? { ...v, key } : v)),
        () => {},
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [values.name, keyTouched]);

  const keyChanged = Boolean(project) && normalizeProjectKey(values.key) !== (project.key || '');

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!values.name.trim()) nextErrors.name = 'Give the project a name.';
    const key = normalizeProjectKey(values.key);
    const sendKey = project ? canEditKey && keyChanged : keyTouched && key !== '';
    if (sendKey) {
      const keyError = projectKeyError(key);
      if (keyError) nextErrors.key = keyError;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit({
        name: values.name.trim(),
        description: values.description.trim(),
        visibility: values.visibility,
        ...(sendKey ? { key } : {}),
      });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setFormError(describeError(error));
      setSaving(false);
    }
  }

  const sample = normalizeProjectKey(values.key) || 'KEY';
  const keyHint = project
    ? canEditKey
      ? keyChanged && project.key
        ? `Tasks become ${sample}-1, ${sample}-2 … Links and searches that use ${project.key} keep working.`
        : `Tasks are numbered ${sample}-1, ${sample}-2 …`
      : 'Only the project owner or an admin can change the key.'
    : `Tasks will be numbered ${sample}-1, ${sample}-2 … Letters A to Z, ${PROJECT_KEY_MAX} at most.`;

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={project ? 'Edit project' : 'New project'}
      description={project ? undefined : 'You become the owner and can add members next.'}
    >
      <form className="task-form" noValidate onSubmit={handleSubmit}>
        {formError ? (
          <p className="form-alert" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {formError}
          </p>
        ) : null}
        <Field label="Name" error={errors.name}>
          <input
            className="input"
            value={values.name}
            maxLength={LIMITS.projectNameMax + 10}
            onChange={(e) => {
              const name = e.target.value;
              setValues((v) => ({ ...v, name, ...(keyTouched ? {} : { key: name.trim() ? suggestProjectKey(name) : '' }) }));
              setErrors({});
            }}
            autoFocus
          />
        </Field>
        <Field label="Key" hint={keyHint} error={errors.key}>
          <input
            className="input input-key"
            value={values.key}
            maxLength={PROJECT_KEY_MAX}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            readOnly={Boolean(project) && !canEditKey}
            onChange={(e) => {
              setKeyTouched(true);
              setValues((v) => ({ ...v, key: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }));
              setErrors((current) => ({ ...current, key: undefined }));
            }}
          />
        </Field>
        <Field label="Description" hint="Optional. What is this project for?" error={errors.description}>
          <textarea className="textarea" rows={3} value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />
        </Field>
        <fieldset className="visibility-options">
          <legend>Who can find it</legend>
          {[
            ['private', 'Private', Lock],
            ['open', 'Open', Globe],
          ].map(([value, label, Icon]) => (
            <label key={value} className="visibility-option">
              <input
                type="radio"
                name="visibility"
                value={value}
                checked={values.visibility === value}
                onChange={() => setValues((v) => ({ ...v, visibility: value }))}
              />
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                {PROJECT_VISIBILITY_SUMMARY[value]}
              </span>
            </label>
          ))}
          {errors.visibility ? <p className="field-error">{errors.visibility}</p> : null}
        </fieldset>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
