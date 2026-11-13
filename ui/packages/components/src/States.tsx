import { Component, type ErrorInfo, type ReactNode } from 'react';

/** The designed states: each looks like something, and says what it is. */
function State(props: { tone: 'quiet' | 'wait' | 'fail'; children: ReactNode }) {
  const cls = props.tone === 'fail' ? 'c-fail' : props.tone === 'wait' ? 'c-wait' : 'faint';
  return (
    <div
      className={cls}
      role="status"
      style={{
        padding: 'var(--space-4)',
        border: 'var(--line-hair) dashed var(--color-rule-strong)',
        fontSize: 'var(--size-sm)',
      }}
    >
      {props.children}
    </div>
  );
}

export function Loading(props: { what?: string }) {
  return <State tone="wait">Loading {props.what ?? ''}…</State>;
}

export function Unavailable(props: { what?: string; detail?: string }) {
  return (
    <State tone="fail">
      {props.what ?? 'This'} is unavailable.{props.detail ? ` ${props.detail}` : ''}
    </State>
  );
}

export function Missing(props: { what: string }) {
  return <State tone="quiet">No such {props.what}.</State>;
}

export function Empty(props: { children: ReactNode }) {
  return <State tone="quiet">{props.children}</State>;
}

/** Data that could not be refreshed: shown, but marked. */
export function Stale(props: { since: Date }) {
  return (
    <span className="c-wait" title={`Last refreshed ${props.since.toISOString()}`}>
      stale
    </span>
  );
}

/**
 * One section of a page, held apart: what fails to render inside it is
 * said there, as unavailable, and the rest of the page stands. Rendered
 * again when `resetKey` changes (another item opened, new data read).
 */
export class Contained extends Component<{ what: string; resetKey?: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: Error | null; key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`${this.props.what} failed to render`, error, info.componentStack);
  }

  render() {
    if (this.state.error) return <Unavailable what={this.props.what} detail={`It failed to render: ${this.state.error.message}`} />;
    return this.props.children;
  }
}
