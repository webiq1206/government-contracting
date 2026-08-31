/**
 * Where you are in a queue, and what "next" means.
 *
 * Every workspace in the product needs the same four answers -- which item is
 * open, how many there are, what is above it, what is below it -- and each of
 * them is one off-by-one away from sending an operator to the wrong record.
 * They are worked out here, over an ordered list of ids, so the rule is one
 * function with tests rather than four expressions written in four pages.
 *
 * Nothing in this file touches the database or React. The pages own the order;
 * this owns the arithmetic.
 */

export interface QueuePosition {
  /** Zero-based, or -1 when nothing is open. */
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
  /** True when the open item is the last one. */
  last: boolean;
}

export function queuePosition(ids: readonly string[], selectedId: string | null): QueuePosition {
  const index = selectedId == null ? -1 : ids.indexOf(selectedId);
  const total = ids.length;
  if (index < 0) {
    return { index: -1, total, prevId: null, nextId: null, last: false };
  }
  return {
    index,
    total,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < total - 1 ? ids[index + 1] : null,
    last: index === total - 1,
  };
}

/**
 * Where an act-and-move-on button should land.
 *
 * The next item, and otherwise nothing.
 *
 * "Otherwise nothing" rather than "otherwise the previous one" is deliberate.
 * Finishing the last row and being dropped back onto a row that is already
 * done reads as the action having failed, and the caller has a better answer
 * available: the queue with no selection, which re-renders without the item
 * just completed and opens whatever is now first. So the last item's next is
 * null, and null means "the list".
 */
export function advanceTarget(ids: readonly string[], selectedId: string | null): string | null {
  return queuePosition(ids, selectedId).nextId;
}

/**
 * The selection a page should render, given what the URL asked for.
 *
 * Falls through to the first item rather than to nothing. A screen whose job
 * is working a queue, showing an empty half because nobody clicked yet, is a
 * screen asking to be used before it does anything. An id that is not in the
 * list -- a bookmark to a record somebody else has since finished -- also
 * falls through to the first, which is the same thing a deleted record does
 * and needs no separate branch.
 */
export function resolveSelection<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  requestedId: string | null
): T | null {
  if (items.length === 0) return null;
  if (requestedId) {
    const found = items.find((i) => idOf(i) === requestedId);
    if (found) return found;
  }
  return items[0];
}

/**
 * Build the queue's own links: the same URL, with the open item swapped.
 *
 * Written here because every page that has ever done this by hand has done it
 * by concatenating strings, and every one of them lost the filters the first
 * time somebody navigated from a filtered list.
 */
export function queueHrefBuilder(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
  key: string
): { forItem: (id: string) => string; base: string } {
  function build(id: string | null): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === key || v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    if (id != null) p.set(key, id);
    const q = p.toString();
    return q ? `${pathname}?${q}` : pathname;
  }
  return { forItem: (id: string) => build(id), base: build(null) };
}
