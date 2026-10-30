import { describe, expect, it } from 'vitest';

import { resolveEvents } from './events';
import { SUPPORTED_WEBHOOK_EVENTS } from './webhook';

describe('resolveEvents', () => {
  it('adds an event the customer was never offered', () => {
    // The connection was saved before `contacts.upsert` joined the
    // grid. Its list cannot say "no" to an event it never saw — and
    // the feature that event carries would simply never reach it.
    const resolved = resolveEvents(['messages.upsert'], undefined);

    expect(resolved.events).toContain('contacts.upsert');
    expect(resolved.events).toContain('messages.upsert');
    expect(resolved.offeredEvents).toEqual([...SUPPORTED_WEBHOOK_EVENTS]);
  });

  it('keeps an event the customer was offered and turned off', () => {
    // The customer SAW it and said no. Their answer is the answer.
    const resolved = resolveEvents(
      ['messages.upsert'],
      [...SUPPORTED_WEBHOOK_EVENTS],
    );

    expect(resolved.events).toEqual(['messages.upsert']);
  });

  it('keeps an event a connection turned off before the bookkeeping existed', () => {
    // This connection predates `offeredEvents`: the grid it saw was
    // the one WITHOUT the late joiners, so the events it had were the
    // ones it was offered — and the one the customer unticked has to
    // stay unticked.
    const resolved = resolveEvents(
      ['messages.upsert', 'messages.update', 'messages.delete', 'connection.update'],
      undefined,
    );

    expect(resolved.events).not.toContain('messages.edited');
    // The event that joined the grid later still comes on its own.
    expect(resolved.events).toContain('contacts.upsert');
  });

  it('does not add an event the customer just ticked', () => {
    const resolved = resolveEvents(
      ['messages.upsert', 'contacts.upsert'],
      undefined,
    );

    expect(resolved.events).toEqual(['messages.upsert', 'contacts.upsert']);
  });

  it('changes nothing when the list is already complete', () => {
    const resolved = resolveEvents([...SUPPORTED_WEBHOOK_EVENTS], undefined);

    expect(resolved.events).toEqual([...SUPPORTED_WEBHOOK_EVENTS]);
  });

  it('offers every supported event from now on', () => {
    const resolved = resolveEvents(['messages.upsert'], ['messages.upsert']);

    expect(resolved.offeredEvents).toEqual([...SUPPORTED_WEBHOOK_EVENTS]);
  });

  it('never repeats an event', () => {
    const resolved = resolveEvents(
      ['messages.upsert', 'contacts.upsert'],
      undefined,
    );

    expect(resolved.events.filter((e) => e === 'contacts.upsert')).toHaveLength(1);
  });
});
