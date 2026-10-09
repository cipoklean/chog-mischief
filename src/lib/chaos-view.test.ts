import { describe, it, expect } from 'vitest';
import { VIEW_COLUMNS, isViewMissing, mapViewRow, type ViewRow } from './chaos-view';

/**
 * The view-reading logic. The view is the structural no-address guard; these
 * tests pin the two things that could quietly break it - the column list
 * drifting (a leaked column) and the missing-view error code changing (the
 * fallback silently never firing).
 */

const row: ViewRow = {
  id: 1,
  from_token_id: 70,
  from_name: 'CHOG #70',
  to_token_id: 3,
  to_name: 'CHOG #3',
  prank_id: 'crown-of-the-chog',
  landed: true,
  revenge: false,
  points: 30,
  created_at: '2026-10-09T00:00:00Z',
};

describe('VIEW_COLUMNS', () => {
  it('names every column the view projects, and nothing else', () => {
    expect(VIEW_COLUMNS.split(',')).toEqual([
      'id',
      'from_token_id',
      'from_name',
      'to_token_id',
      'to_name',
      'prank_id',
      'landed',
      'revenge',
      'points',
      'created_at',
    ]);
  });

  it('never names a signer or signature column', () => {
    // The whole point of the guard: a column named here CANNOT leak.
    expect(VIEW_COLUMNS).not.toMatch(/signer/i);
    expect(VIEW_COLUMNS).not.toMatch(/signature/i);
  });
});

describe('isViewMissing', () => {
  it('recognises the not-applied error codes', () => {
    expect(isViewMissing({ code: '42P01', message: 'relation does not exist' })).toBe(true);
    expect(isViewMissing({ code: 'PGRST202', message: 'not found' })).toBe(true);
  });

  it('does not treat a transient failure as a missing view', () => {
    // A network blip is NOT a deploy state - the log message must say so.
    expect(isViewMissing({ code: '503', message: 'service unavailable' })).toBe(false);
    expect(isViewMissing({ code: 'PGRST301', message: 'timeout' })).toBe(false);
    expect(isViewMissing(null)).toBe(false);
    expect(isViewMissing(undefined)).toBe(false);
    expect(isViewMissing({ message: 'no code at all' })).toBe(false);
  });
});

describe('mapViewRow', () => {
  it('carries every field through and marks the row real', () => {
    expect(mapViewRow(row)).toEqual({ ...row, real: true });
  });

  it('uses the view-joined names, with no second query needed', () => {
    // The view does the join; a mapped row must never fall back to a
    // CHOG #id placeholder when the view returned a name.
    const mapped = mapViewRow({ ...row, from_name: 'Blaze' });
    expect(mapped.from_name).toBe('Blaze');
    expect(mapped.to_name).toBe('CHOG #3');
  });

  it('has no signer or signature field on the mapped shape', () => {
    // Type-level guard made runtime: the API contract simply does not have
    // the fields, so nothing downstream can read them.
    expect(Object.keys(mapViewRow(row))).not.toContain('signer');
    expect(Object.keys(mapViewRow(row))).not.toContain('signature');
  });
});
