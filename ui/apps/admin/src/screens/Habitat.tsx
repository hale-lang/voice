import { useEffect, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Mono, Form, Field, Select, ListInput, Button, micros } from '@hale/components';
import { useGet, type Project } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go } from '../route';
import { readout } from '../readout';

/**
 * Voice's habitat, its customer: every organism's app and tooling inside it
 * is a client, calling with a key the habitat draws, and each organism is a
 * tenant project, `tenant-<organism>`, made on its first call. The operator
 * says once what the habitat may spend; every tenant inherits it, live,
 * unless narrowed on its own project.
 */
export function Habitat({ setInspector }: ScreenProps) {
  const grant = useGet('/admin/v1/habitat');
  const projects = useGet('/admin/v1/projects', { params: { query: { include_archived: true } } });
  useEffect(() => setInspector(null), [setInspector]);

  if (grant.isPending || projects.isPending) return <Loading what="the habitat" />;
  if (grant.isError) return <Unavailable what="The habitat" detail={grant.error.message} />;
  if (projects.isError) return <Unavailable what="Projects" detail={projects.error.message} />;
  const tenants = projects.data.data.filter((p) => p.inherits || p.id.startsWith('tenant-'));
  const granted = grant.data.accounts;

  return (
    <>
      <h1>Habitat</h1>
      <Grant accounts={granted} fresh={readout(grant)} />
      <Panel title="Tenants" readout={readout(projects, `${tenants.length} tenants`)}>
        <p className="muted" style={{ marginTop: 0 }}>
          Each organism of the habitat, made a project on its first call. One that inherits spends what the habitat may; one narrowed on its project spends its own.
        </p>
        <Table<Project>
          rows={tenants}
          rowKey={(p) => p.id}
          onSelect={(p) => go('projects', p.id)}
          columns={[
            { key: 'id', header: 'Tenant', render: (p) => <Mono>{p.id}</Mono> },
            { key: 'from', header: 'Accounts from', render: (p) => (p.inherits ? 'the habitat' : <span className="c-wait">its own (narrowed)</span>) },
            { key: 'accounts', header: 'Spends', render: (p) => spends(p, granted) },
            { key: 'keys', header: 'Keys', num: true, render: (p) => p.key_count ?? 0 },
            { key: 'spent', header: 'Spent', num: true, render: (p) => (p.budget ? micros(p.budget.spent_micros, p.budget.currency) : <span className="faint">no budget</span>) },
          ]}
          empty="No tenant yet: an organism becomes one on its first call."
        />
      </Panel>
    </>
  );
}

/** The accounts a tenant spends now: the habitat's for one that inherits. */
function spends(p: Project, granted: string[]) {
  const a = p.inherits ? granted : p.accounts;
  if (a == null) return <span className="muted">any</span>;
  if (!a.length) return <span className="c-wait">none: nothing serves it</span>;
  return <Mono>{a.join(', ')}</Mono>;
}

/** What the habitat may spend, which every inheriting tenant spends from its next call. */
function Grant({ accounts, fresh }: { accounts: string[]; fresh: string }) {
  const w = useWrite();
  const known = useGet('/admin/v1/accounts');
  const [scope, setScope] = useState<'none' | 'these'>(accounts.length ? 'these' : 'none');
  const [names, setNames] = useState<string[]>(accounts);
  useEffect(() => {
    setScope(accounts.length ? 'these' : 'none');
    setNames(accounts);
  }, [accounts]);
  const active = (known.data?.data ?? []).filter((a) => a.status === 'active').map((a) => a.id).join(', ');
  return (
    <Panel title="What the habitat may spend" readout={fresh}>
      <p className="muted" style={{ marginTop: 0 }}>
        The habitat is voice's customer: every organism's app and tooling inside it calls voice. Set once what it may spend; every tenant that inherits spends it from its next call.
      </p>
      <Form
        error={w.error}
        onSubmit={async () => { await w.write('put', '/admin/v1/habitat', { body: { accounts: scope === 'these' ? names : [] } }); }}
        actions={<Button type="submit" tone="primary" disabled={w.busy}>save</Button>}
      >
        <Field label="accounts" help={active ? `active accounts: ${active}` : 'no account yet: create one on Accounts'}>
          <Select value={scope} onChange={(v) => setScope(v as 'none' | 'these')} options={[{ value: 'none', label: 'none' }, { value: 'these', label: 'these' }]} />
        </Field>
        {scope === 'these' && (
          <Field label="which">
            <ListInput mono value={names} onChange={setNames} placeholder="local" />
          </Field>
        )}
      </Form>
    </Panel>
  );
}
