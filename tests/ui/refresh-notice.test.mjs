import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RefreshNotice } from '../../src/components/ui/RefreshNotice.jsx';

it('announces a refresh failure and retries', () => {
  const retry = vi.fn();
  render(React.createElement(RefreshNotice, { onRetry: retry }));
  expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh.");
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledOnce();
});
