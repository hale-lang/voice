import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Shell, RailHeader, RailNav, RailPrincipal, Evidence, ago, Form, Field, TextInput, Button, Select, DETAIL_LAYOUTS, type DetailLayout } from '@hale/components';
import { useRoute, href, go } from './route';
import { useGet } from './api/client';
import { Overview } from './screens/Overview';
import { Network } from './screens/Network';
import { Nodes } from './screens/Nodes';
import { Usage } from './screens/Usage';
import { Routes } from './screens/Routes';
import { Changes } from './screens/Changes';
import { Accounts } from './screens/Accounts';
import { Catalog } from './screens/Catalog';
import { Projects } from './screens/Projects';
import { Api } from './screens/Api';
import { Recipes } from './screens/Recipes';
import { Runtimes } from './screens/Runtimes';
import { Placements } from './screens/Placements';
import { useAdminEvents } from './api/events';
import { useOperatorToken, keepOperatorToken } from './api/token';
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

const NAV = [
  { href: href(), label: 'Overview', key: '' },
  { href: href('network'), label: 'Network', key: 'network' },
  { href: href('usage'), label: 'Usage', key: 'usage' },
  { href: href('routes'), label: 'Route table', key: 'routes' },
  { href: href('nodes'), label: 'Nodes', key: 'nodes' },
  { href: href('accounts'), label: 'Accounts', key: 'accounts' },
  { href: href('catalog'), label: 'Catalog', key: 'catalog' },
  { href: href('placements'), label: 'Placements', key: 'placements' },
  { href: href('recipes'), label: 'Recipes', key: 'recipes' },
  { href: href('runtimes'), label: 'Runtimes', key: 'runtimes' },
  { href: href('projects'), label: 'Projects', key: 'projects' },
  { href: href('changes'), label: 'Changes', key: 'changes' },
  { href: href('api'), label: 'API', key: 'api' },
];

export function App() {
  const token = useOperatorToken();
  if (!token) return <OperatorToken />;
  return <Admin />;
}

/**
 * The admin plane takes the operator token: asked for once, kept in this
 * browser (api/token.ts), and asked for again when the api refuses it.
 */
function OperatorToken() {
  const [value, setValue] = useState('');
  return (
    <Shell rail={<RailHeader app="voice" sub="admin" />} evidence={null}>
      <Form
        onSubmit={() => keepOperatorToken(value.trim())}
        actions={<Button type="submit" tone="primary">continue</Button>}
      >
        <Field label="operator token" required help="standalone: docker compose exec api voice-api admin-token; in a habitat: hale dna secret show operator-token">
          <TextInput mono value={value} onChange={setValue} required pattern="\s*[0-9a-zA-Z_-]+\s*" placeholder="va-... or the habitat's" />
        </Field>
      </Form>
    </Shell>
  );
}

function Admin() {
  const route = useRoute();
  const [inspector, setInspector] = useState<ReactNode>(null);
  const section = route.parts[0] ?? '';
  const screen = { '': Overview, network: Network, nodes: Nodes, usage: Usage, routes: Routes, changes: Changes, accounts: Accounts, catalog: Catalog, placements: Placements, recipes: Recipes, runtimes: Runtimes, projects: Projects, api: Api }[section];
  const Screen = screen ?? Overview;

  // The inspector belongs to the screen; a new screen starts it empty. A
  // layout effect, so it runs before the screen's own effect fills it.
  useLayoutEffect(() => setInspector(null), [section]);
  const [layout, setLayout] = useDetailLayout();
  const close = useCallback(() => go(section), [section]);

  return (
    <Shell
      wide={section === 'network'}
      rail={
        <>
          <RailHeader app="voice" sub="admin" />
          <RailNav items={NAV.map((n) => ({ ...n, active: n.key === section }))} />
          <RailPrincipal>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div className="faint" style={{ marginBottom: 2 }}>open items as</div>
              <Select value={layout} onChange={(v) => setLayout(v as DetailLayout)} options={DETAIL_LAYOUTS} />
            </div>
            operator · <a href="#" onClick={(e) => { e.preventDefault(); keepOperatorToken(null); }}>forget token</a>
          </RailPrincipal>
        </>
      }
      detail={inspector}
      layout={layout}
      onClose={close}
      evidence={<EvidenceStrip />}
    >
      <Screen route={route} setInspector={setInspector} />
    </Shell>
  );
}

/** How the viewer likes items opened (the rail's picker), kept in this browser. */
function useDetailLayout(): [DetailLayout, (l: DetailLayout) => void] {
  const [layout, set] = useState<DetailLayout>(() => {
    try {
      const v = localStorage.getItem('voice.detail-layout');
      return v === 'page' || v === 'drawer' || v === 'inline' ? v : 'page';
    } catch {
      return 'page';
    }
  });
  const keep = useCallback((l: DetailLayout) => {
    set(l);
    try {
      localStorage.setItem('voice.detail-layout', l);
    } catch {
      // kept for this visit only
    }
  }, []);
  return [layout, keep];
}

export type ScreenProps = { route: ReturnType<typeof useRoute>; setInspector: (n: ReactNode) => void };

/** Source, revision and freshness: what the canvas is showing, from where. */
function EvidenceStrip() {
  const health = useGet('/readyz');
  const stream = useAdminEvents();
  const fetching = useIsFetching();
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const newest = Math.max(0, ...qc.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt));
  const version = health.data?.version ?? '–';
  const state = health.isError ? 'unreachable' : health.data?.status ?? 'connecting';
  return (
    <Evidence
      items={[
        { label: 'source', value: 'voice api, same origin' },
        { label: 'api', value: <span className={health.isError ? 'c-fail' : undefined}>{state} {version}</span> },
        { label: 'refreshed', value: newest ? `${ago(new Date(newest).toISOString(), now)} ago` : '–' },
        { label: 'events', value: <span className={stream === 'open' ? undefined : stream === 'closed' ? 'c-wait' : 'faint'}>{stream}</span> },
        { label: '', value: fetching ? <span className="c-active pulse">fetching</span> : <span className="faint">idle</span> },
      ]}
    />
  );
}
