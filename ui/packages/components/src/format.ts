/** Formatting for an instrument: units muted, numbers tabular. */

export function micros(n: number, currency = 'USD'): string {
  const v = n / 1_000_000;
  const digits = Math.abs(v) < 1 ? 4 : 2;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}

export function count(n: number): string {
  return n.toLocaleString();
}

/** A size in bytes, in binary units as memory is quoted: "512 MiB", "64 GiB". */
export function bytes(n: number | null | undefined): string {
  if (n == null) return '–';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${u === 0 || v >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** A relative time, short: "3s", "12m", "2h", "5d". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Time until, as "in 43h", or "due" once passed. */
export function until(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s <= 0) return 'due';
  return `in ${ago(new Date(now - s * 1000).toISOString(), now)}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(undefined, { hour12: false });
}
