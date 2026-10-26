'use client';

import { cloneElement, isValidElement, useId } from 'react';

/**
 * Label + control + hint/error, wired for screen readers.
 * Pass a single input/select/textarea element as the child.
 */
export function Field({ label, hint, error, children, className }) {
  const generatedId = useId();
  const id = (isValidElement(children) && children.props.id) || generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
      })
    : children;

  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {control}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
