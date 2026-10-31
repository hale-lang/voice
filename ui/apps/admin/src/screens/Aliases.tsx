import { useState } from 'react';
import { Mono, Select, TextInput, Button } from '@hale/components';
import { useGet, type Project } from '../api/client';
import { useWrite } from '../api/mutate';

/** The names voice suggests models by: its catalog's categories (catalog/picks.json). */
const CATEGORIES = ['general', 'coding', 'reasoning', 'decide'];

type Alias = { name: string; model: string };

/**
 * The names a project gives models: a caller asks for `coding` and is served
 * the model it names here, moved without the caller changing anything. A
 * child's are its own over its parent's, name by name. Voice's categories
 * come first; any other name may be added.
 */
export function Aliases({ project: p }: { project: Project }) {
  const w = useWrite();
  const models = useGet('/admin/v1/models');
  const own: Alias[] = p.aliases ?? [];
  const resolved = p.resolved_aliases ?? [];
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const names = [...CATEGORIES, ...resolved.map((a) => a.name).filter((n) => !CATEGORIES.includes(n))];
  const options = (models.data?.data ?? []).map((m) => ({ value: m.id }));
  const save = async (next: Alias[]) => {
    await w.write('patch', '/admin/v1/projects/{project}', { params: { path: { project: p.id } }, body: { aliases: next } });
  };
  const set = (n: string, v: string) => {
    const rest = own.filter((a) => a.name !== n);
    // "" is none of its own: the parent's again, where it has one
    void save(v ? [...rest, { name: n, model: v }] : rest);
  };
  const archived = p.status === 'archived';
  return (
    <div>
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--size-sm)' }}>
        <tbody>
          {names.map((n) => {
            const mine = own.find((a) => a.name === n);
            const inherited = resolved.find((a) => a.name === n && a.from !== p.id);
            return (
              <tr key={n}>
                <td style={{ padding: '2px var(--space-3) 2px 0' }}>
                  <Mono>{n}</Mono>
                </td>
                <td style={{ padding: '2px 0' }}>
                  {archived ? (
                    mine?.model ?? inherited?.model ?? <span className="faint">none</span>
                  ) : (
                    <Select
                      value={mine?.model ?? ''}
                      onChange={(v) => set(n, v)}
                      empty={inherited ? `${inherited.from}'s: ${inherited.model}` : 'none'}
                      options={options}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!archived && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
          <TextInput mono value={name} onChange={setName} placeholder="another name" pattern="[a-z0-9][a-z0-9\-]{0,62}" />
          <Select value={model} onChange={setModel} empty="model" options={options} />
          <Button
            disabled={!name || !model || w.busy}
            onClick={async () => {
              await save([...own.filter((a) => a.name !== name), { name, model }]);
              setName('');
              setModel('');
            }}
          >
            add
          </Button>
        </div>
      )}
      {w.error && <p className="c-fail">{w.error}</p>}
    </div>
  );
}
