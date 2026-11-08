/**
 * An annotation run's answer for one request (`AnnotationRunOutcome`):
 * queued, or refused and why, with the project and key it was sent under.
 */
export type RunOutcome = { request_id: string; queued: boolean; reason: string; message: string; project?: string; key?: string };

/**
 * Why one request was not annotated, in plain words, the api's message
 * first. Annotation off names the project to turn it on for (`turnOn`),
 * said after as ": turn it on in Projects".
 */
export type Refusal = { said: string; turnOn?: { project: string } };

/** Each reason's words when the api gave no message. */
const PLAIN: Record<string, string> = {
  not_annotating: 'annotation is off for its project and key',
  no_annotator: 'no annotator applies to this request',
  no_text: 'the request has no recorded text to read',
  unknown: 'voice has no record of this request',
};

export function refusalOf(o: RunOutcome): Refusal {
  const said = o.message.trim() || PLAIN[o.reason] || (o.reason ? o.reason.replace(/_/g, ' ') : 'not queued');
  if (o.reason === 'not_annotating') return { said, turnOn: { project: o.project ?? '' } };
  return { said };
}

/** A refusal as one line of text: its words, and where annotation is turned on. */
export function refusalLine(o: RunOutcome): string {
  const r = refusalOf(o);
  return r.turnOn ? `${r.said}: turn it on in Projects` : r.said;
}

/** One reason's share of a run's refusals: how many, in words, and for annotation off, the projects. */
export type RefusedGroup = { reason: string; count: number; words: string; projects: string[] };

/** A reason's words, after its count. */
const COUNTED: Record<string, string> = {
  not_annotating: 'with annotation off',
  no_annotator: 'that no annotator applies to',
  no_text: 'with no recorded text to read',
  unknown: 'that voice has no record of',
};

/**
 * A run's refusals, counted by why, the most first: "3 with no recorded
 * text to read", "1 with annotation off" (and its projects). Empty when
 * none was refused.
 */
export function refusedGroups(outcomes: RunOutcome[]): RefusedGroup[] {
  const by = new Map<string, RefusedGroup>();
  for (const o of outcomes) {
    if (o.queued) continue;
    const g = by.get(o.reason) ?? { reason: o.reason, count: 0, words: COUNTED[o.reason] ?? `refused: ${o.reason.replace(/_/g, ' ') || 'no reason given'}`, projects: [] };
    g.count += 1;
    if (o.reason === 'not_annotating' && o.project && !g.projects.includes(o.project)) g.projects.push(o.project);
    by.set(o.reason, g);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** A run's refusals as one line of text, as `RefusedSummary` shows them. */
export function refusedLine(outcomes: RunOutcome[]): string {
  return refusedGroups(outcomes)
    .map((g) => `${g.count} ${g.words}${g.reason === 'not_annotating' ? `${g.projects.length ? ` for ${g.projects.map((p) => `project ${p}`).join(', ')}` : ''}: turn it on in Projects` : ''}`)
    .join('; ');
}
