/** A cabled port as the node found it (protocol.yaml `CabledPort`), as far as its cabling is said. */
export type CabledPortLike = { ifname: string; speed_mbps: number };

/** A link's check (`LinkCheck`), as far as its state reads it. */
export type LinkCheckLike = {
  status: 'running' | 'passed' | 'failed';
  degraded: boolean;
  bus_bytes_per_second?: number;
  reason?: string;
};

/** A node's link as the coordinator sees it (`NodeLink`), as far as its state reads it. */
export type LinkLike = {
  peer: string;
  paired: boolean;
  source: 'declared' | 'discovered';
  addressed: boolean;
  check?: LinkCheckLike;
};

/** One link's state: its line, how it reads, and whether a check may be started from here. */
export type LinkState = { tone: 'quiet' | 'ok' | 'wait' | 'fail'; text: string; checkable: boolean };

/** A speed in Mb/s as a link is sold: `200 Gb/s`, `10 Gb/s`, `100 Mb/s`. */
export function speedSaid(mbps: number): string {
  if (mbps >= 1000) return `${Number((mbps / 1000).toFixed(1))} Gb/s`;
  return `${mbps} Mb/s`;
}

/** Bytes a second as an all-reduce's bandwidth is said, in decimal GB/s: `22.9 GB/s`. */
export function bandwidthSaid(bps: number): string {
  return `${(bps / 1e9).toFixed(1)} GB/s`;
}

/** `2 ports cabled (200 Gb/s)`: the node's cabled ports, and their speeds. */
export function cabledSaid(ports: CabledPortLike[]): string {
  const speeds = [...new Set(ports.filter((p) => p.speed_mbps > 0).map((p) => p.speed_mbps))].sort((a, b) => b - a);
  const n = ports.length === 1 ? '1 port cabled' : `${ports.length} ports cabled`;
  return speeds.length ? `${n} (${speeds.map(speedSaid).join(', ')})` : n;
}

/**
 * What a node's links section says before any link: its cabled ports with
 * no peer found, or that nothing is cabled. Never silent while the
 * hardware shows a cable.
 */
export function cablingState(ports: CabledPortLike[] | undefined, links: LinkLike[] | undefined): string {
  const cabled = ports ?? [];
  if ((links ?? []).length > 0) return '';
  if (cabled.length === 0) return 'no cabled port found, and its capabilities file declares no link';
  return `${cabledSaid(cabled)}, no peer found`;
}

/**
 * One link's state, as a line: cabled and not addressed; no link back;
 * not checked yet; its check running, failed, passed (with what it
 * measured) or passed but degraded. A check may be started while the
 * node is up, the link addressed and paired, and none is running.
 */
export function linkState(l: LinkLike, nodeUp: boolean): LinkState {
  const to = `cabled to ${l.peer}`;
  if (!l.addressed) return { tone: 'wait', text: `${to}, not addressed`, checkable: false };
  if (!l.paired) return { tone: 'wait', text: `${to} · ${l.peer} has no link back`, checkable: false };
  const checkable = nodeUp && l.check?.status !== 'running';
  const c = l.check;
  if (!c) return { tone: 'quiet', text: `${to} · not checked`, checkable };
  if (c.status === 'running') return { tone: 'wait', text: `${to} · link check running`, checkable };
  if (c.status === 'failed') return { tone: 'fail', text: `${to} · link check failed${c.reason ? `: ${c.reason}` : ''}`, checkable };
  if (c.degraded) return { tone: 'wait', text: `degraded: ${degradedWhy(c)}`, checkable };
  return { tone: 'ok', text: `${to} · link check passed${c.bus_bytes_per_second ? ` ${bandwidthSaid(c.bus_bytes_per_second)}` : ''}`, checkable };
}

/** Why a passed check is degraded: what the api says after `degraded: `, or what it measured. */
function degradedWhy(c: LinkCheckLike): string {
  const at = c.reason?.indexOf('degraded: ') ?? -1;
  if (c.reason && at >= 0) return c.reason.slice(at + 'degraded: '.length);
  return c.bus_bytes_per_second ? `${bandwidthSaid(c.bus_bytes_per_second)} measured` : 'no bandwidth measured';
}
