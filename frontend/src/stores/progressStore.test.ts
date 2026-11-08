import { beforeEach, describe, expect, it } from 'vitest';
import { completedCount, effectiveStatus, SESSION_ID, useProgressStore } from './progressStore';

beforeEach(() => useProgressStore.getState().resetProgress());

describe('ticket status vs. the learner record', () => {
  it('resolving a ticket records a completion with the best time', () => {
    const p = () => useProgressStore.getState();
    p().setRun('DCT-0002', { status: 'in_progress', session: SESSION_ID });
    p().setRun('DCT-0002', { status: 'resolved', session: SESSION_ID, resolvedInMs: 90_000 });
    expect(p().completed['DCT-0002']).toMatchObject({ count: 1, bestMs: 90_000 });
    // Validating an already-resolved ticket again does not count twice.
    p().setRun('DCT-0002', { status: 'resolved', session: SESSION_ID, resolvedInMs: 90_000 });
    expect(p().completed['DCT-0002'].count).toBe(1);
    // A second run after a reset keeps the better time.
    p().reopenTickets();
    p().setRun('DCT-0002', { status: 'resolved', session: SESSION_ID, resolvedInMs: 60_000 });
    expect(p().completed['DCT-0002']).toMatchObject({ count: 2, bestMs: 60_000, lastMs: 60_000 });
  });

  it('a simulation reset reopens every ticket but keeps completions', () => {
    const p = () => useProgressStore.getState();
    p().setRun('DCT-0002', { status: 'resolved', session: SESSION_ID, resolvedInMs: 1000 });
    p().setRun('DCT-0003', { status: 'closed', session: SESSION_ID });
    p().setRun('DCT-0004', { status: 'in_progress', session: SESSION_ID, validations: 2 });
    p().reopenTickets();
    for (const id of ['DCT-0002', 'DCT-0003', 'DCT-0004']) expect(effectiveStatus(p().workOrders[id])).toBe('open');
    expect(completedCount(p().completed, ['DCT-0002', 'DCT-0003', 'DCT-0004'])).toBe(2);
    expect(p().workOrders['DCT-0004'].validations).toBe(2);
  });

  it('runs from another tab read as open, whatever their status', () => {
    expect(effectiveStatus({ status: 'resolved', validations: 1, session: 'another-tab' })).toBe('open');
    expect(effectiveStatus({ status: 'closed', validations: 1, session: 'another-tab' })).toBe('open');
    expect(effectiveStatus({ status: 'closed', validations: 1, session: SESSION_ID })).toBe('closed');
  });
});
