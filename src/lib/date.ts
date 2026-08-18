// Deterministic date formatting for SSR-rendered components.
//
// `new Date(...).toLocaleDateString()` is unsafe inside server components
// because the server's timezone/locale and the browser's differ — React
// then sees two different rendered strings and throws a hydration
// mismatch. Use `formatDate(...)` from this module everywhere an admin
// or public SSR page renders a date.
//
// Output format: "DD MMM YYYY" using UTC components, e.g. "19 Aug 2026".
// The same input timestamp always produces the same string on every host.
//
// We hand-roll the month names so the output never depends on
// `Intl.DateTimeFormat` defaults — a safer choice than pinning a locale,
// because pinned locales can still vary by ICU version across runtimes.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const TWO_DIGIT = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

function toDate(value: string | number | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    // Supabase returns ISO strings (with Z). new Date(...) parses them,
    // but empty/invalid strings produce NaN dates — guard.
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// "19 Aug 2026"
export function formatDate(value: string | number | Date): string {
  const d = toDate(value);
  if (!d) return '';
  const day = TWO_DIGIT(d.getUTCDate());
  const month = MONTHS[d.getUTCMonth()] ?? '';
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

// Optional alternate: "19/08/2026" for dense tables.
export function formatDateNumeric(value: string | number | Date): string {
  const d = toDate(value);
  if (!d) return '';
  const day = TWO_DIGIT(d.getUTCDate());
  const month = TWO_DIGIT(d.getUTCMonth() + 1);
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
