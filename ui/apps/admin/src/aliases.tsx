import { Mono } from '@hale/components';
import { useGet, type Project } from './api/client';
import { href } from './route';

/** A name a project gives a catalog model (`ModelAlias`), and the project. */
export type NamedBy = { project: string; name: string };

/**
 * Per catalog model, the aliases that name it: each project's own, so a
 * child that takes its parent's is not listed again (Projects shows what is
 * in force for each).
 */
export function aliasesByModel(projects: Project[]): Map<string, NamedBy[]> {
  const out = new Map<string, NamedBy[]>();
  for (const p of projects) {
    for (const a of p.aliases ?? []) out.set(a.model, [...(out.get(a.model) ?? []), { project: p.id, name: a.name }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));
  return out;
}

/** The active projects' aliases, by the model each names. */
export function useAliasesByModel(): Map<string, NamedBy[]> {
  const q = useGet('/admin/v1/projects');
  return aliasesByModel(q.data?.data ?? []);
}

/** Aliases as `project: name`, each linking to its project. */
export function NamedByList({ names }: { names: NamedBy[] | undefined }) {
  if (!names?.length) return <span className="faint">none</span>;
  return (
    <>
      {names.map((n, i) => (
        <span key={`${n.project}/${n.name}`}>
          {i > 0 && ', '}
          <a href={href('projects', n.project)}>{n.project}</a>: <Mono>{n.name}</Mono>
        </span>
      ))}
    </>
  );
}
