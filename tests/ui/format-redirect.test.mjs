import { describe, expect, it } from 'vitest';
import { formatRelative } from '../../src/lib/format.js';
import { safeNext } from '../../src/lib/redirect.js';

describe('formatRelative', () => {
  const now = new Date(2026, 10, 6, 0, 30);

  it('counts calendar days rather than 24-hour blocks', () => {
    expect(formatRelative(new Date(2026, 10, 6, 0, 29, 50).toISOString(), now)).toBe('just now');
    expect(formatRelative(new Date(2026, 10, 6, 0, 5).toISOString(), now)).toBe('25 min ago');
    expect(formatRelative(new Date(2026, 10, 5, 23, 0).toISOString(), now)).toMatch(/^yesterday at 23:00$/);
    // 25.5 hours earlier, but two calendar days back: not "yesterday".
    expect(formatRelative(new Date(2026, 10, 4, 23, 0).toISOString(), now)).toBe('4 Nov');
    expect(formatRelative(new Date(2026, 10, 6, 0, 0).toISOString(), new Date(2026, 10, 6, 9, 0))).toBe('today at 00:00');
  });

  it('adds the year for other years and ignores invalid input', () => {
    expect(formatRelative(new Date(2025, 11, 31, 12).toISOString(), now)).toBe('31 Dec 2025');
    expect(formatRelative('not a date', now)).toBe('');
  });
});

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/projects/project-alpha?task=task-001')).toBe('/projects/project-alpha?task=task-001');
  });

  it('rejects anything that could leave the site', () => {
    for (const value of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\\/evil.example', '/\tevil', '/x\u0000y']) {
      expect(safeNext(value)).toBe('/dashboard');
    }
  });
});
