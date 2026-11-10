/**
 * Adding a model that is served by a subscription or by a remote API, with
 * today's admin API: a catalog model (`createCatalogModel`), then a seat on
 * a node whose capabilities offer the engine (`createSeat`). A local model
 * is placed instead (Placements), which makes its own seat.
 */

/** The Claude models the CLI takes by alias (`claude --model`), or its default. */
export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
  { value: '', label: "the CLI's default" },
];

/** The vault entry the node's install keeps an account's Claude token in. */
export function tokenEntry(account: string): string {
  return `claude-token--${account}`;
}

/** A node as far as the add form reads it: its id, state and declared engines. */
export type NodeEngines = { id: string; status: string; capabilities?: { engines: { id: string; kind: string }[] } | null };

/** One node's engine of a kind, which a seat names. */
export type Offer = { node: string; engine: string };

/** Every node (not revoked) that declares an engine of `kind`, each with its first such engine. */
export function nodesOffering(nodes: NodeEngines[], kind: string): Offer[] {
  const out: Offer[] = [];
  for (const n of nodes) {
    if (n.status === 'revoked') continue;
    const e = n.capabilities?.engines.find((x) => x.kind === kind);
    if (e) out.push({ node: n.id, engine: e.id });
  }
  return out;
}

/** What to do when no node offers an engine of `kind`, in plain words. */
export function noNodeOffers(kind: 'claude-cli' | 'openai-compatible'): string {
  return kind === 'claude-cli'
    ? 'no node offers claude-cli: install the claude CLI and place the node again'
    : "no node offers openai-compatible: declare an engine of that kind in a node's capabilities file";
}

/** A seat id made from a model's name: a slug of at most 63. */
export function seatIdFor(model: string): string {
  const s = model.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 63).replace(/-+$/, '');
  return s || 'seat';
}

/** `base`, else `base-2`, `base-3`…: the first a node's seats do not take. */
export function freshSeatId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(id)) return id;
  }
}

type Price = { input_per_mtok_micros: number; output_per_mtok_micros: number; currency: string };

/** The two writes that add a model: the catalog model, then its seat on `node`. */
export type AddWrites = {
  model: { id: string; owned_by: string; kind: 'hosted'; context_length?: number; max_output_tokens?: number; price: Price | null };
  node: string;
  seat: {
    id: string;
    engine: string;
    account: string;
    serves: { model: string; as?: string | null }[];
    concurrency: number;
    enabled: boolean;
    config: Record<string, unknown>;
  };
};

/**
 * A Claude subscription's model: the claude-cli seat runs the CLI under the
 * account's token (its vault entry), with `--model` set to the alias chosen
 * (none for its default). Flat-rate: no price.
 */
export function claudeWrites(a: { model: string; offer: Offer; account: string; vault: string; cliModel: string }): AddWrites {
  return {
    model: { id: a.model, owned_by: 'anthropic', kind: 'hosted', price: null },
    node: a.offer.node,
    seat: {
      id: seatIdFor(a.model),
      engine: a.offer.engine,
      account: a.account,
      serves: [{ model: a.model }],
      concurrency: 1,
      enabled: true,
      config: { token_vault: a.vault, ...(a.cliModel ? { model: a.cliModel } : {}) },
    },
  };
}

/** A price in USD per million tokens, as micros; null unless both are given. */
export function priceOf(input: number | null, output: number | null): Price | null {
  return input != null && output != null
    ? { input_per_mtok_micros: Math.round(input * 1e6), output_per_mtok_micros: Math.round(output * 1e6), currency: 'USD' }
    : null;
}

/** The host a URL names, or "" for one that is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * A remote API's model: the openai-compatible seat sends requests to
 * `baseUrl` as the upstream's own model name, with the key from its vault
 * entry (none for an endpoint that takes none). Metered at the price given.
 */
export function apiWrites(a: {
  model: string;
  offer: Offer;
  account: string;
  baseUrl: string;
  keyVault: string;
  upstream: string;
  price: Price | null;
  contextLength: number | null;
}): AddWrites {
  const base = a.baseUrl.trim().replace(/\/+$/, '');
  return {
    model: {
      id: a.model,
      owned_by: hostOf(base) || 'hosted',
      kind: 'hosted',
      ...(a.contextLength ? { context_length: a.contextLength } : {}),
      price: a.price,
    },
    node: a.offer.node,
    seat: {
      id: seatIdFor(a.model),
      engine: a.offer.engine,
      account: a.account,
      serves: [{ model: a.model }],
      concurrency: 4,
      enabled: true,
      config: { base_url: base, model: a.upstream.trim(), ...(a.keyVault.trim() ? { api_key_vault: a.keyVault.trim() } : {}) },
    },
  };
}
