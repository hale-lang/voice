import { useState } from 'react';
import { useGet } from './api/client';
import { useWrite } from './api/mutate';

/** `s` as a placement id: lowercase letters, digits and dashes, at most 63. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '');
}

/**
 * Placing a recipe on a node or a pair, the one way the UI does it: the
 * catalog model whose weights are the recipe (one named for it first, else
 * the first local model of it), added when the catalog has none; then a
 * placement of it on `nodes` (the leader first), spending the account
 * chosen, of the variant named or the one voice picks. Every rule is the
 * api's (`createPlacement`). The node page's suggestions and the Recipes
 * screen's fit explorer both place through it.
 */
export function usePlaceRecipe() {
  const models = useGet('/admin/v1/models');
  const accounts = useGet('/admin/v1/accounts');
  const placements = useGet('/admin/v1/placements');
  const w = useWrite();
  const [account, setAccount] = useState('');
  const options = (accounts.data?.data ?? []).filter((a) => a.status !== 'archived');
  // an account that bills no one is the natural payer of a local seat
  const payer = account || (options.find((a) => (a.billing ?? 'none') === 'none') ?? options[0])?.id || '';
  const place = async (recipe: string, nodes: string[], variant?: string): Promise<string | null> => {
    if (!payer || nodes.length === 0) return null;
    const all = models.data?.data ?? [];
    // a model's id says nothing of its weights, so one of the same id with
    // another recipe is not it, and a new one takes a free id
    const bound = all.find((m) => m.id === recipe && m.recipe === recipe) ?? all.find((m) => m.kind === 'local' && m.recipe === recipe);
    let model = bound?.id ?? null;
    if (!model) {
      model = await w.createFresh('/admin/v1/models', recipe, new Set(all.map((m) => m.id)), (id) => ({ id, owned_by: 'local', kind: 'local', recipe }));
      if (!model) return null;
    }
    const chosen = model;
    const [leader, follower] = nodes;
    // a placement's id is a slug, never reused, even once removed
    return w.createFresh('/admin/v1/placements', slug(`${recipe}-on-${leader}${follower ? `-and-${follower}` : ''}`), new Set((placements.data?.data ?? []).map((p) => p.id)), (id) => ({
      id,
      model: chosen,
      account: payer,
      nodes,
      ...(variant ? { variant } : {}),
    }));
  };
  return { place, payer, setAccount, accounts: options, w };
}
