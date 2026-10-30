/**
 * Context windows, in tokens: what a model is made for (its recipe's or the
 * catalog's `context_length`) and what a seat's server took (its node
 * reports it once the server answers). A seat that serves less than its
 * model is made for is shown so.
 */

/** Tokens, short: 32768 → `32k`, 1048576 → `1M`, 202752 → `198k`. */
export function tokens(n: number): string {
  if (n >= 1048576 && n % 1048576 === 0) return `${n / 1048576}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}k`;
  return String(n);
}

/** `served of native`, flagged when the served is less; either alone when only one is known. */
export function ContextWindow({ served, native }: { served?: number | null; native?: number | null }) {
  if (!served && !native) return <span className="faint">–</span>;
  if (!served) return <span title={`${native!.toLocaleString()} tokens: the model's own; no seat has said what it serves`}>{tokens(native!)}</span>;
  if (!native || served >= native) return <span title={`${served.toLocaleString()} tokens served`}>{tokens(served)}</span>;
  return (
    <span className="c-wait" title={`served ${served.toLocaleString()} of the ${native.toLocaleString()} tokens the model is made for`}>
      {tokens(served)} <span className="muted">of {tokens(native)}</span>
    </span>
  );
}
