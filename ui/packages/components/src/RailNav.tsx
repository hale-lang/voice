import { useId, useState, type KeyboardEvent } from 'react';
import s from './RailNav.module.css';

export type RailLink = { href: string; label: string; active?: boolean };

/**
 * Links the rail lists together. A labelled group is a layer: its label a
 * heading that opens its first link, its links under it. An unlabelled
 * one is links of their own; `apart` sets it off below a rule.
 */
export type RailGroup = { label?: string; apart?: boolean; items: RailLink[] };

/**
 * The rail's grouped navigation. The current link is marked
 * (`aria-current`), and its group with it. On a narrow screen each layer
 * folds to its heading and a disclosure button, the current one open; the
 * arrow keys (and Home, End) move between the links shown.
 */
export function RailNav(props: { groups: RailGroup[] }) {
  const id = useId();
  const current = props.groups.findIndex((g) => g.label && g.items.some((it) => it.active));
  // the group opened or closed by hand, until the current one changes
  const [chosen, setChosen] = useState<{ current: number; open: number | null }>({ current, open: current });
  const open = chosen.current === current ? chosen.open : current;

  return (
    <div className={s.nav} onKeyDown={move}>
      {props.groups.map((g, i) => {
        const listId = `${id}-${i}`;
        const list = (
          <ul className={s.items} id={listId}>
            {g.items.map((it) => (
              <li key={it.href}>
                <a href={it.href} className={`${s.link} ${it.active ? s.active : ''}`} aria-current={it.active ? 'page' : undefined}>
                  {it.label}
                </a>
              </li>
            ))}
          </ul>
        );
        if (!g.label) {
          return (
            <div key={i} className={`${s.plain} ${g.apart ? s.apart : ''}`}>
              {list}
            </div>
          );
        }
        const isOpen = open === i;
        return (
          <div key={i} role="group" aria-labelledby={`${listId}-h`} className={`${s.group} ${isOpen ? s.open : ''} ${i === current ? s.current : ''} ${g.apart ? s.apart : ''}`}>
            <h2 className={s.head}>
              <a id={`${listId}-h`} href={g.items[0]?.href}>{g.label}</a>
              <button
                type="button"
                className={s.disclose}
                aria-expanded={isOpen}
                aria-controls={listId}
                aria-label={`${g.label} links`}
                onClick={() => setChosen({ current, open: isOpen ? null : i })}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            </h2>
            {list}
          </div>
        );
      })}
    </div>
  );
}

/** The arrow keys, Home and End: focus the next, previous, first or last link or button shown. */
function move(e: KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
  if (step === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
  const shown = [...e.currentTarget.querySelectorAll<HTMLElement>('a, button')].filter((el) => el.getClientRects().length > 0);
  const at = shown.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const to = step === -Infinity ? 0 : step === Infinity ? shown.length - 1 : Math.min(shown.length - 1, Math.max(0, at + step));
  e.preventDefault();
  shown[to]?.focus();
}
