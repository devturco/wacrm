// ============================================================
// The events a connection receives.
//
// The provider delivers ONLY the events on its list — the list WE
// push to it when the connection is saved. So the list is both a
// filter and a promise: an event that is not on it never arrives,
// and an event that IS on it arrives whether the customer wants it
// or not.
//
// The grid on the settings screen offers every supported event, and
// the customer ticks the ones they want. That answer is saved in
// `webhook.events` — and it is the whole truth about what the
// customer chose.
//
// The trouble is an event that joins the grid LATER. A connection
// saved before `contacts.upsert` existed has a list that cannot
// mention it: the customer was never asked, so their list is not a
// "no". Left alone, the event would never reach those connections —
// and the feature it carries (the contact's picture, free of charge,
// straight from the provider) would simply be missing for them.
//
// So the saved settings carry ONE more thing: `offeredEvents`, the
// events that were on the screen the last time the customer saved.
// The rule falls out of it:
//
//   - an event the customer WAS offered and did not tick → their
//     choice, and it stays unticked;
//   - an event the customer was NEVER offered → ours to add, once.
//
// Nothing here talks to the provider and nothing here throws: the
// caller is a route, and the list is a preference.
// ============================================================

import { SUPPORTED_WEBHOOK_EVENTS } from './webhook';

/**
 * The events that joined the grid AFTER the first connections were
 * saved.
 *
 * A connection saved before they joined was never offered them: its
 * list cannot say "no" to an event it never saw. Those are added on
 * their own — once — and never again.
 *
 * EVERY event that joins the grid goes in this list. A connection saved
 * before the bookkeeping existed has no other way to learn about it.
 */
const LATE_JOINERS = ['contacts.upsert'];

export interface ResolvedEvents {
  /** The events the connection receives from now on. */
  events: string[];
  /** The events the customer is offered from now on. */
  offeredEvents: string[];
}

/**
 * The events a connection must GAIN, and the list it is offered.
 *
 * @param events     the events the customer ticked (or the ones we
 *                    are pushing, on a creation);
 * @param offered    the events that were on the screen the last time
 *                    this connection was saved. `undefined` means the
 *                    connection predates the bookkeeping — the grid it
 *                    saw was the one WITHOUT the late joiners, so
 *                    those are the only ones it never had a chance to
 *                    answer about.
 */
export function resolveEvents(
  events: string[],
  offered: string[] | undefined,
): ResolvedEvents {
  const chosen = new Set(events);
  const alreadyOffered = new Set(
    offered ??
      SUPPORTED_WEBHOOK_EVENTS.filter((event) => !LATE_JOINERS.includes(event)),
  );

  const gained = SUPPORTED_WEBHOOK_EVENTS.filter(
    (event) => !chosen.has(event) && !alreadyOffered.has(event),
  );

  return {
    events: gained.length > 0 ? [...events, ...gained] : [...events],
    offeredEvents: [...SUPPORTED_WEBHOOK_EVENTS],
  };
}
