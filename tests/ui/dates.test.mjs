import { describe, expect, it } from 'vitest';
import { localToday, resolveToday, utcToday } from '../../src/lib/dates.js';

describe('date helpers', () => {
  const now = new Date('2026-10-15T19:00:00.000Z');
  it('validates calendar format, real dates, and UTC distance', () => {
    expect(resolveToday('10/16/2026', now)).toBe('2026-10-15');
    expect(resolveToday('2026-02-30', now)).toBe('2026-10-15');
    expect(resolveToday('2026-10-17', now)).toBe('2026-10-15');
    expect(resolveToday('2026-10-16', now)).toBe('2026-10-16');
  });
  it('gives the UTC day, which is still yesterday in India until 5:30 am', () => {
    // 2 am on 15 Nov in India.
    expect(utcToday(new Date('2026-11-14T20:30:00.000Z'))).toBe('2026-11-14');
    expect(utcToday(new Date('2026-11-15T00:00:00.000Z'))).toBe('2026-11-15');
  });
  it('formats local calendar fields', () => {
    expect(localToday(new Date(2026, 9, 16, 0, 30))).toBe('2026-10-16');
  });
});
