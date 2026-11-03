import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AppError from '../../src/app/(app)/error.jsx';

it('shows the shared error state and retries the route when requested', () => {
  const reset = vi.fn();
  render(React.createElement(AppError, { error: new Error('Request failed'), reset }));
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(reset).toHaveBeenCalledOnce();
});
