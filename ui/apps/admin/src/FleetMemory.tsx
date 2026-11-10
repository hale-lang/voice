import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { MemoryCard, MemoryKey, MemoryNeed, MemoryTip, Mono, Status, bytes, huesFor, planCells, unitSaid, CELLS, type MemoryPoint } from '@hale/components';
import { api, describe, useGet, useNodes, type Schemas } from './api/client';
import { useRefetchInterval } from './api/live';
import { cardGroups, fleetNodes, nameBeside, linkSaid, memoryOf, pairsOf, placedBlocks, type FleetBlock, type FleetNode, type FleetPair, type FleetUnmet } from './fleet-memory';
import { toneOf } from './tone';
import s from './FleetMemory.module.css';

type LinkCheck = Schemas['LinkCheck'];
type Links = (a: string, b: string) => LinkCheck | undefined;

export type FleetMemoryProps = {
  nodes: FleetNode[];
  /** What is placed now. */
  now: FleetBlock[];
  /** What a plan places (its keeps, removals and additions), when there is one. */
  plan?: FleetBlock[] | null;
  /** What the plan leaves unfilled. */
  unmet?: FleetUnmet[];
  /** Which state is drawn; the plan's when there is one, unless chosen. */
  view?: 'now' | 'plan';
  onView?: (v: 'now' | 'plan') => void;
  links?: Links;
  /** Small cards with no legends: the whole fleet at a glance. */
  compact?: boolean;
  /** Only these nodes' cards, in this order. */
  only?: string[];
  /** A block kept lit (the placement a page is about). */
  lit?: string | null;
  selected?: string | null;
  onSelect?: (block: string) => void;
  /** A node's card opens it. */
  onOpenNode?: (node: string) => void;
  /** The node a page is about, its card marked. */
  current?: string;
  /** What the key leads with (a source toggle, say). */
  lead?: ReactNode;
};

/**
 * The fleet's memory for models, a card a node (`MemoryCard`): what it
 * holds back, each placement in a hue of its own, free cells. A model
 * split across two nodes has the same hue on both cards, which sit side by
 * side under a bracket naming its link. Beside a plan, the plan or what is
 * placed now: the plan's kept blocks hold their cells, its additions glow,
 * and what its removals free is struck through; then what it leaves
 * unfilled, each at the size it would take. Hovering a model lights it on
 * every node and says what it is; choosing it selects it.
 */
export function FleetMemory(p: FleetMemoryProps) {
  const [ownView, setOwnView] = useState<'now' | 'plan'>('plan');
  const [hover, setHover] = useState<{ key: string; at: MemoryPoint } | null>(null);
  const view = p.plan ? (p.view ?? ownView) : 'now';
  const setView = (v: 'now' | 'plan') => (p.onView ? p.onView(v) : setOwnView(v));
  const kept = useMemo(() => (p.plan ? new Set(p.plan.filter((b) => b.mark === 'kept').map((b) => b.key)) : undefined), [p.plan]);
  const shownNodes = p.only ? p.only.map((id) => p.nodes.find((n) => n.id === id)).filter((n): n is FleetNode => !!n) : p.nodes;
  const blocks = view === 'plan' && p.plan ? p.plan : p.now;
  const pairs = pairsOf(blocks, p.links);
  const groups = p.only ? [p.only.filter((id) => shownNodes.some((n) => n.id === id))] : cardGroups(shownNodes, [...pairsOf(p.now), ...pairsOf(p.plan ?? [])]);
  // hues over the whole fleet, now and planned, so a model keeps its hue
  // across the views and on every page that draws it
  const hues = useMemo(() => huesFor([...p.now, ...(p.plan ?? [])].map((b) => b.key)), [p.now, p.plan]);
  const lit = hover?.key ?? p.lit ?? null;
  const info = (key: string) => blocks.find((b) => b.key === key) ?? p.now.find((b) => b.key === key) ?? p.plan?.find((b) => b.key === key);
  const onHover = (key: string | null, at?: MemoryPoint) => setHover(key && at ? { key, at } : null);

  const card = (n: FleetNode) => {
    const nowModel = memoryOf(n, p.now, kept);
    const status = <Status tone={toneOf(n.status)} label={n.status} />;
    const subtitle = [n.accelerator, n.memoryBytes != null ? bytes(n.memoryBytes) : null].filter(Boolean).join(' · ');
    if (!nowModel) {
      return (
        <div key={n.id} className={s.unmeasured} aria-label={`${n.id} memory`}>
          <div className={s.unmeasuredHead}>
            {p.onOpenNode ? <button type="button" className={s.linkish} onClick={() => p.onOpenNode!(n.id)}><Mono>{n.id}</Mono></button> : <Mono>{n.id}</Mono>}
            {status}
          </div>
          <span className="faint">has not measured its machine: nothing is placed on it</span>
        </div>
      );
    }
    const planModel = view === 'plan' && p.plan ? memoryOf(n, p.plan, kept) : null;
    const said = nameBeside(n);
    return (
      <div key={n.id} className={`${s.slot} ${p.current === n.id ? s.current : ''}`}>
        <MemoryCard
          name={n.id}
          title={said ? <>{n.id} <span className="faint">{said}</span></> : undefined}
          titleText={said ? `${n.id} ${said}` : n.id}
          subtitle={subtitle}
          status={status}
          model={planModel ?? nowModel}
          cells={planModel ? planCells(nowModel, planModel) : undefined}
          compact={p.compact}
          highlight={lit}
          selected={p.selected}
          onHover={onHover}
          onSelect={p.onSelect}
          onOpen={p.onOpenNode ? () => p.onOpenNode!(n.id) : undefined}
          hues={hues}
          animate
        />
      </div>
    );
  };

  return (
    <div className={s.fleet}>
      <div className={s.bar}>
        {p.lead}
        {p.plan && <Toggle label="which fleet is drawn" value={view} options={[['now', 'now'], ['plan', 'plan']]} onChange={setView} />}
        <MemoryKey plan={view === 'plan' && !!p.plan} overhead="its server's own" />
      </div>
      <div className={s.cards}>
        {groups.map((g) => {
          const members = g.map((id) => shownNodes.find((n) => n.id === id)).filter((n): n is FleetNode => !!n);
          if (members.length === 1) return card(members[0]!);
          const spans = pairs.filter((x) => g.includes(x.nodes[0]) && g.includes(x.nodes[1]));
          return (
            <div key={g.join('+')} className={s.group}>
              <div className={s.groupCards}>{members.map(card)}</div>
              {spans.map((x) => <Bracket key={x.key} pair={x} hue={hues.get(x.key) ?? 205} block={info(x.key)} lit={lit === x.key} onHover={onHover} onSelect={p.onSelect} />)}
            </div>
          );
        })}
        {shownNodes.length === 0 && <span className="faint">No node to draw.</span>}
      </div>
      {view === 'plan' && p.unmet && p.unmet.length > 0 && <Tray unmet={p.unmet} nodes={p.nodes} />}
      {hover && info(hover.key) && (
        <MemoryTip at={hover.at}>
          <BlockSaid block={info(hover.key)!} hue={hues.get(hover.key) ?? 205} pair={pairs.find((x) => x.key === hover.key)} />
        </MemoryTip>
      )}
    </div>
  );
}

/** Two or more choices, one pressed: which fleet is drawn, or where it is read from. */
export function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className={s.views} role="group" aria-label={label}>
      {options.map(([v, said]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{said}</button>
      ))}
    </div>
  );
}

/** A pair's bracket: the model's hue spanning its two cards, and the link it runs over. */
function Bracket({ pair, hue, block, lit, onHover, onSelect }: { pair: FleetPair; hue: number; block?: FleetBlock; lit: boolean; onHover: (k: string | null, at?: MemoryPoint) => void; onSelect?: (k: string) => void }) {
  const style = { '--h': hue } as CSSProperties;
  return (
    <button
      type="button"
      className={`${s.bracket} ${lit ? s.bracketLit : ''}`}
      style={style}
      onMouseEnter={(e) => onHover(pair.key, { x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null)}
      onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); onHover(pair.key, { x: r.left + 24, y: r.bottom }); }}
      onBlur={() => onHover(null)}
      onClick={onSelect ? () => onSelect(pair.key) : undefined}
      aria-label={`${block?.model ?? pair.key} across ${pair.nodes.join(' and ')}, ${linkSaid(pair.link)}`}
    >
      <span className={s.bracketLine} aria-hidden="true" />
      <span className={s.bracketLabel}>
        <Mono>{block?.model ?? pair.key}</Mono>
        <span className="muted"> across {pair.nodes.join(' + ')} · link {linkSaid(pair.link)}</span>
      </span>
    </button>
  );
}

const MARK: Record<string, string> = { kept: 'kept as it is', added: 'added by the plan', removed: 'removed by the plan' };

/** What a block is, as its tip says it. */
function BlockSaid({ block: b, hue, pair }: { block: FleetBlock; hue: number; pair?: FleetPair }) {
  const server = b.reservedBytes != null ? b.heldBytes - b.reservedBytes : null;
  return (
    <div className={s.said}>
      <div><span className={s.swatch} style={{ '--h': hue } as CSSProperties} aria-hidden="true" /><Mono>{b.model}</Mono></div>
      {(b.variant || b.runtime) && <div className="muted">{b.variant}{b.runtime ? ` under ${b.runtime}` : ''}</div>}
      <div>
        {b.heldBytes > 0 ? <>{bytes(b.heldBytes)}{b.nodes.length > 1 ? ' on each node' : ''}</> : <span className="faint">size not told (placed before voice sized it)</span>}
        {server != null && server > 0 && <span className="muted"> · {bytes(b.reservedBytes)} reserved, {bytes(server)} its server's</span>}
      </div>
      <div className="muted">placement <Mono>{b.key}</Mono> on {b.nodes.join(', ')}{pair ? ` · link ${linkSaid(pair.link)}` : ''}</div>
      {(b.serves.length > 0 || b.aliases.length > 0) && (
        <div>{b.serves.length > 0 && <>serves {b.serves.join(', ')}</>}{b.aliases.length > 0 && <span className="muted"> · alias {b.aliases.join(', ')}</span>}</div>
      )}
      {b.mark && <div className={b.mark === 'added' ? 'c-active' : b.mark === 'removed' ? 'c-wait' : 'muted'}>{MARK[b.mark]}</div>}
      {b.why && <div className={s.why}>{b.why}</div>}
    </div>
  );
}

/**
 * What a plan leaves unfilled, each at the size it would take: the "doesn't
 * fit" tray. A want's need is what it would hold of each node it needs, not
 * of one node in particular, so it is said in bytes, and drawn in cells of
 * the node with the most memory, the most room any card has: past a
 * hundred, it fits on no node whole.
 */
function Tray({ unmet, nodes }: { unmet: FleetUnmet[]; nodes: FleetNode[] }) {
  const largest = nodes.reduce<FleetNode | undefined>((a, n) => (n.memoryBytes != null && n.memoryBytes > (a?.memoryBytes ?? 0) ? n : a), undefined);
  const unit = largest?.memoryBytes ? largest.memoryBytes / CELLS : 0;
  return (
    <section className={s.tray} aria-label="does not fit">
      <h3>Does not fit · {unmet.length}</h3>
      <ul>
        {unmet.map((u) => {
          const cells = u.needBytes && unit > 0 ? Math.max(1, Math.round(u.needBytes / unit)) : 0;
          const against = largest ? `${cells} cells of ${largest.id}'s ${CELLS} (1 cell ≈ ${unitSaid(unit)})` : '';
          return (
            <li key={u.want}>
              <div className={s.trayHead}>
                <Status tone="wait" label={u.want} />
                <span className="mono muted">{u.needBytes ? `at least ${bytes(u.needBytes)} a node${against ? ` · ${against}` : ''}` : 'no model can fill it'}</span>
              </div>
              {cells > 0 && largest && <MemoryNeed cells={cells} label={`${u.want} needs ${bytes(u.needBytes)} on each node it takes: ${against}`} />}
              <div className={s.why}>{u.reason}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The checks of the links `pairs` run over: each pair's leader read whole
 * (`getNode`, under the key the node's page reads it by, so the events that
 * refresh nodes refresh it).
 */
export function usePairLinks(pairs: { nodes: string[] }[]): Links {
  const refetchInterval = useRefetchInterval();
  const leaders = [...new Set(pairs.filter((x) => x.nodes.length === 2).map((x) => x.nodes[0]!))].sort();
  const reads = useQueries({
    queries: leaders.map((node) => {
      const init = { params: { path: { node } } };
      return {
        queryKey: ['/admin/v1/nodes/{node}', init] as const,
        refetchInterval,
        queryFn: async () => {
          const r = await api.GET('/admin/v1/nodes/{node}', init);
          if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
          return r.data;
        },
      };
    }),
  });
  return (a, b) => {
    for (const q of reads) {
      const n = q.data;
      if (!n || (n.id !== a && n.id !== b)) continue;
      const peer = n.id === a ? b : a;
      const c = n.links?.find((l) => l.peer === peer)?.check;
      if (c) return c;
    }
    return undefined;
  };
}

/**
 * The fleet's memory now, from the api: its nodes as the hub reports them,
 * its placements, and the links its pairs run over. Nothing is read on a
 * timer while the events flow.
 */
export function useFleetMemory() {
  const nodes = useNodes();
  const placements = useGet('/admin/v1/placements');
  const now = useMemo(() => placedBlocks(placements.data?.data ?? []), [placements.data]);
  const fleet = useMemo(() => fleetNodes(nodes.data?.data ?? []), [nodes.data]);
  const links = usePairLinks(now);
  const failed = nodes.error ?? placements.error;
  return { nodes: fleet, now, links, pending: nodes.isPending || placements.isPending, error: failed ? failed.message : null, placements: placements.data?.data ?? [], nodesQuery: nodes };
}

/**
 * Nodes `ids` at a glance, from the api: each one's card with its legend,
 * `lit` (a placement) lit on them. A page's header: a node's, or a
 * placement's nodes.
 */
export function NodeMemory({ ids, lit, compact }: { ids: string[]; lit?: string; compact?: boolean }) {
  const f = useFleetMemory();
  if (f.pending) return <span className="faint pulse">reading memory…</span>;
  if (f.error) return <span className="faint">memory unavailable: {f.error}</span>;
  return <FleetMemory nodes={f.nodes} now={f.now} links={f.links} only={ids} lit={lit} compact={compact} />;
}
