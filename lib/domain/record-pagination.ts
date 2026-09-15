/** Bound a record list without hiding the total or trusting URL numbers. */
export function recordPage(total: number, value: unknown, size = 12) {
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 1;
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(requested) ? requested : 1));
  return { page, pages, start: (page - 1) * size, end: Math.min(page * size, total), total };
}
