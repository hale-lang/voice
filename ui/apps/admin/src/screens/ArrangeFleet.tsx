import { useMemo, useState } from 'react';
import { Panel } from '@hale/components';
import type { Schemas } from '../api/client';
import { FleetMemory, Toggle, useFleetMemory, usePairLinks } from '../FleetMemory';
import { fleetNodes, placedBlocks, plannedBlocks, unmetOf } from '../fleet-memory';
import { DEMO_NODES, DEMO_PLACEMENTS, DEMO_PLAN, demoLink } from '../fleet-memory-demo';

type Plan = Schemas['ArrangementPlan'];

const DEMO = {
  nodes: fleetNodes(DEMO_NODES),
  now: placedBlocks(DEMO_PLACEMENTS),
  plan: plannedBlocks(DEMO_PLAN, DEMO_PLACEMENTS),
  unmet: unmetOf(DEMO_PLAN),
};

/**
 * The arranger's fleet, drawn (FleetMemory.tsx): each node's memory as it
 * is placed now, and once planned, as the plan would leave it, the one or
 * the other; what the plan cannot fit in a tray. Choosing a model selects
 * its step in the plan. A labeled demo fleet (three Sparks, a Mac and a plan for
 * them) draws it with no fleet behind it.
 */
export function ArrangeFleet({ plan, selected, onSelect }: { plan: Plan | null; selected: string | null; onSelect: (block: string) => void }) {
  const f = useFleetMemory();
  const planned = useMemo(() => (plan ? plannedBlocks(plan, f.placements) : null), [plan, f.placements]);
  const links = usePairLinks([...f.now, ...(planned ?? [])]);
  const [source, setSource] = useState<'fleet' | 'demo'>('fleet');
  const [view, setView] = useState<'now' | 'plan'>('plan');
  const demo = source === 'demo';
  const lead = <Toggle label="memory drawn from" value={source} options={[['fleet', 'fleet'], ['demo', 'demo fleet']]} onChange={setSource} />;
  const readout = demo ? 'demo · synthetic, no host' : planned ? (view === 'plan' ? 'the plan, as it would leave each node' : 'placed now') : 'placed now';
  return (
    <Panel title="Fleet" readout={readout}>
      {!demo && f.error ? (
        <>{lead}<p className="faint">memory unavailable: {f.error}</p></>
      ) : !demo && f.pending ? (
        <span className="faint pulse">reading memory…</span>
      ) : (
        <FleetMemory
          nodes={demo ? DEMO.nodes : f.nodes}
          now={demo ? DEMO.now : f.now}
          plan={demo ? DEMO.plan : planned}
          unmet={demo ? DEMO.unmet : plan ? unmetOf(plan) : undefined}
          view={view}
          onView={setView}
          links={demo ? demoLink : links}
          selected={demo ? null : selected}
          onSelect={demo ? undefined : onSelect}
          lead={lead}
        />
      )}
    </Panel>
  );
}
