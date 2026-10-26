'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';

/** Create or edit a project (TM-F-020). */
export function ProjectFormDialog({ open, onOpenChange, project, onSubmit }) {
  const [values, setValues] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({ name: project?.name || '', description: project?.description || '' });
      setErrors({});
      setFormError(null);
      setSaving(false);
    }
  }, [open, project]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!values.name.trim()) {
      setErrors({ name: 'Give the project a name.' });
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit({ name: values.name.trim(), description: values.description.trim() });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setFormError(describeError(error));
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
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
              setValues((v) => ({ ...v, name: e.target.value }));
              setErrors({});
            }}
            autoFocus
          />
        </Field>
        <Field label="Description" hint="Optional. What is this project for?" error={errors.description}>
          <textarea className="textarea" rows={3} value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />
        </Field>
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
