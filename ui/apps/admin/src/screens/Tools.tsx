import { useEffect, useState } from 'react';
import { Panel, Kv, Form, Field, NumberInput, TextArea, Checkbox, Button, Loading, Unavailable, Mono, bytes, count } from '@hale/components';
import { useGet, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { readout } from '../readout';

type WebFetch = Schemas['ToolSettings']['web_fetch'];

/**
 * The hosted tools voice runs itself for the operator's own requests (the
 * Chat): `web_fetch`, on or off, its limits and its denylist. Each request
 * reads them, so a change takes the next one.
 */
export function Tools(_: ScreenProps) {
  const q = useGet('/admin/v1/tools');
  if (q.isPending) return <Loading what="the tools' settings" />;
  if (q.isError) return <Unavailable what="The tools' settings" detail={q.error.message} />;
  const w = q.data.web_fetch;
  return (
    <>
      <h1>Tools</h1>
      <p className="muted">
        Hosted tools are run by voice, between a model's calls, for the operator's own requests: a chat turns one on, and a project key's request can never list it. A
        fetched page's text reaches the model only as the tool's output, never as instructions.
      </p>
      <Panel title="web fetch" readout={readout(q, w.enabled ? 'on' : 'off', `${w.max_calls} a request`)}>
        <Kv
          rows={[
            { k: 'state', v: w.enabled ? 'on' : <span className="c-wait">off</span> },
            { k: 'fetches a request', v: count(w.max_calls) },
            { k: 'timeout', v: `${(w.timeout_ms / 1000).toFixed(1)} s` },
            { k: 'reads at most', v: bytes(w.max_bytes) },
            { k: 'gives the model at most', v: `${count(w.max_chars)} characters` },
            { k: 'denied', v: w.denylist.length ? <Mono>{w.denylist.join(', ')}</Mono> : <span className="faint">nothing: every host the api reaches, the LAN included</span> },
          ]}
        />
        <WebFetchForm value={w} />
      </Panel>
    </>
  );
}

/** The settings, edited whole: each is sent, so what is saved is what is shown. */
function WebFetchForm({ value }: { value: WebFetch }) {
  const write = useWrite();
  const [enabled, setEnabled] = useState(value.enabled);
  const [maxCalls, setMaxCalls] = useState<number | null>(value.max_calls);
  const [timeoutS, setTimeoutS] = useState<number | null>(value.timeout_ms / 1000);
  const [maxKiB, setMaxKiB] = useState<number | null>(Math.round(value.max_bytes / 1024));
  const [maxChars, setMaxChars] = useState<number | null>(value.max_chars);
  const [deny, setDeny] = useState(value.denylist.join('\n'));
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [enabled, maxCalls, timeoutS, maxKiB, maxChars, deny]);

  const save = async () => {
    const body: Schemas['ToolSettings'] = {
      web_fetch: {
        enabled,
        max_calls: maxCalls ?? 8,
        timeout_ms: Math.round((timeoutS ?? 15) * 1000),
        max_bytes: Math.round((maxKiB ?? 2048) * 1024),
        max_chars: maxChars ?? 40000,
        denylist: deny
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
      },
    };
    if (await write.write('put', '/admin/v1/tools', { body })) setSaved(true);
  };

  return (
    <Form
      onSubmit={save}
      error={write.error}
      actions={
        <>
          <Button type="submit" tone="primary" disabled={write.busy}>
            save
          </Button>
          {saved && <span className="faint">saved: the next request is held to it</span>}
        </>
      }
    >
      <Field label="web fetch" help="offered to a chat whose model takes tool calls">
        <Checkbox checked={enabled} onChange={setEnabled} label="on" />
      </Field>
      <Field label="fetches a request" help="1 to 32; then the model answers from what it has">
        <NumberInput value={maxCalls} onChange={setMaxCalls} min={1} max={32} step={1} required />
      </Field>
      <Field label="timeout (s)" help="a fetch's whole time, its redirects included: 1 to 120">
        <NumberInput value={timeoutS} onChange={setTimeoutS} min={1} max={120} step={0.5} required />
      </Field>
      <Field label="reads at most (KiB)" help="a larger body is an error the model is told: 1 to 16384">
        <NumberInput value={maxKiB} onChange={setMaxKiB} min={1} max={16384} step={1} required />
      </Field>
      <Field label="text given to the model (characters)" help="more is cut, and the model is told it was: 1,000 to 100,000">
        <NumberInput value={maxChars} onChange={setMaxChars} min={1000} max={100000} step={1000} required />
      </Field>
      <Field label="denylist" help="one a line: a host name (and every name under it), an IP address, a CIDR range, or any of them with :port. An address or range matches a URL written with that address; deny a name by its name.">
        <TextArea mono value={deny} onChange={setDeny} rows={5} placeholder={'192.0.2.0/24\nadmin.example.com\n198.51.100.7:8443'} />
      </Field>
    </Form>
  );
}
