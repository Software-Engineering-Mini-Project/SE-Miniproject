'use client';

import { forwardRef } from 'react';
import { Spinner } from './States';

/**
 * @param {{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg',
 *   loading?: boolean, iconOnly?: boolean, block?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', loading = false, iconOnly = false, block = false, type = 'button', disabled, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={className ? `btn ${className}` : 'btn'}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-icon-only={iconOnly || undefined}
      data-block={block || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="btn-label">{children}</span>
      {loading ? <Spinner /> : null}
    </button>
  );
});
