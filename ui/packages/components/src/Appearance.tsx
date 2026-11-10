import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  THEMES, themeNamed, resolveTheme, followPair, customColors, nearStates, readChoice, writeChoice, applyTheme, hueGradient,
  type Choice, type Theme,
} from '@hale/tokens/theme';
import s from './Appearance.module.css';

const LIGHT = '(prefers-color-scheme: light)';

function usePrefersLight(): boolean {
  const [light, setLight] = useState(() => typeof matchMedia === 'function' && matchMedia(LIGHT).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia(LIGHT);
    const on = () => setLight(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return light;
}

/**
 * The theme this browser chose, kept under `storageKey` and applied to the
 * document's root: data-theme, plus the custom accent and base hue as
 * inline custom properties. The page's inline boot script applied the same
 * before the first render (@hale/tokens/boot); this keeps it current as
 * the choice, the system's scheme, or another tab's choice changes.
 */
export function useTheme(storageKey: string) {
  const [choice, setChoice] = useState<Choice>(() => readChoice(storageKey));
  const prefersLight = usePrefersLight();
  const name = resolveTheme(choice, prefersLight);
  const theme = themeNamed(name);
  const custom = useMemo(() => customColors(choice, theme), [choice, theme]);
  useLayoutEffect(() => applyTheme(document.documentElement, name, custom.vars), [name, custom]);
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === storageKey) setChoice(readChoice(storageKey));
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [storageKey]);
  const latest = useRef(choice);
  latest.current = choice;
  const update = useCallback(
    (patch: Partial<Choice>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setChoice(next);
      writeChoice(storageKey, next);
    },
    [storageKey],
  );
  return { choice, update, theme, colors: custom.colors };
}

/**
 * The appearance control: a theme from the list (each with its swatch),
 * following the system's light or dark, a custom accent and a base hue,
 * each with a way back. Opens from a quiet line in the rail, over the
 * canvas, and closes on Esc or a click elsewhere.
 */
export function Appearance(props: { storageKey: string }) {
  const { choice, update, theme, colors } = useTheme(props.storageKey);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  // beside its line: above it when the line is low (the rail's foot),
  // below it when high (the rail across the top of a narrow screen)
  useLayoutEffect(() => {
    if (!open) return;
    const placeIt = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 8, edge = 16, width = 300;
      const left = Math.max(edge, Math.min(r.left, window.innerWidth - width - edge));
      const above = r.top > window.innerHeight / 2;
      setPlace(
        above
          ? { left, bottom: window.innerHeight - r.top + gap, ['--room' as string]: `${r.top - gap - edge}px` }
          : { left, top: r.bottom + gap, ['--room' as string]: `${window.innerHeight - r.bottom - gap - edge}px` },
      );
    };
    placeIt();
    window.addEventListener('resize', placeIt);
    window.addEventListener('scroll', placeIt, true);
    return () => {
      window.removeEventListener('resize', placeIt);
      window.removeEventListener('scroll', placeIt, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const custom = choice.accent !== null || choice.hue !== null;
  return (
    <div className={s.appearance} ref={root}>
      <button
        ref={button}
        type="button"
        className={s.toggle}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        theme · <span className={s.current}>{theme.label}{custom ? ' · custom' : ''}</span>
      </button>
      {open && (
        <div className={s.panel} style={place} id={id} role="group" aria-label="Appearance">
          <div className={s.inner}>
            <ThemeList choice={choice} shown={theme.name} onPick={(name) => update({ theme: name })} />
            <Follow choice={choice} onChange={(follow) => update({ follow })} />
            <Accent choice={choice} colors={colors} onChange={(accent) => update({ accent })} />
            <BaseHue choice={choice} colors={colors} onChange={(hue) => update({ hue })} />
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeList(props: { choice: Choice; shown: string; onPick: (name: string) => void }) {
  const group = useId();
  return (
    <fieldset className={s.section}>
      <legend className={s.head}>
        <span>theme</span>
        <span className="readout">{THEMES.length} themes</span>
      </legend>
      <div className={s.themes}>
        {THEMES.map((t) => (
          <label key={t.name} className={`${s.theme} ${t.name === props.shown ? s.shown : ''}`}>
            <input
              type="radio"
              name={group}
              value={t.name}
              checked={props.choice.theme === t.name}
              onChange={() => props.onPick(t.name)}
            />
            <Swatch theme={t} />
            <span className={s.themeName}>{t.label}</span>
            <span className="readout">{t.scheme}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A theme in miniature: its panel, its text, its accent and its three states. */
function Swatch(props: { theme: Theme }) {
  const c = props.theme.color;
  return (
    <span className={s.swatch} style={{ background: c['bg-1'], borderColor: c['rule-strong'] }} aria-hidden="true">
      <span style={{ background: c.text }} />
      <span style={{ background: c.accent }} />
      <span style={{ background: c.green }} />
      <span style={{ background: c.amber }} />
      <span style={{ background: c.coral }} />
    </span>
  );
}

function Follow(props: { choice: Choice; onChange: (v: boolean) => void }) {
  const p = followPair(props.choice);
  return (
    <div className={s.section}>
      <label className={s.check}>
        <input type="checkbox" checked={props.choice.follow} onChange={(e) => props.onChange(e.target.checked)} />
        <span>follow system</span>
      </label>
      <div className={s.note}>
        light {themeNamed(p.light).label} · dark {themeNamed(p.dark).label}
      </div>
    </div>
  );
}

const STATE_WORD = { ok: 'ok', wait: 'waiting', fail: 'failed' } as const;

function Accent(props: { choice: Choice; colors: Record<string, string>; onChange: (v: string | null) => void }) {
  const picked = props.choice.accent;
  const shown = props.colors.accent ?? '';
  const [text, setText] = useState(picked ?? '');
  useEffect(() => setText(picked ?? ''), [picked]);
  const commit = (v: string) => {
    const hex = v.trim().replace(/^([0-9a-fA-F]{6})$/, '#$1');
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) props.onChange(hex.toUpperCase());
    else setText(picked ?? '');
  };
  const near = picked ? nearStates(picked, props.colors) : [];
  return (
    <div className={s.section}>
      <div className={s.head}>
        <span>accent</span>
        <span className="readout">{picked ? 'custom' : 'theme’s'}</span>
      </div>
      <div className={s.row}>
        <input
          type="color"
          className={s.color}
          aria-label="accent colour"
          value={(picked ?? shown).toLowerCase()}
          onChange={(e) => props.onChange(e.target.value.toUpperCase())}
        />
        <input
          className={s.hex}
          aria-label="accent colour, hex"
          value={text}
          placeholder={shown}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => e.target.value && commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
        />
        <button type="button" className={s.reset} disabled={!picked} onClick={() => props.onChange(null)}>
          reset
        </button>
      </div>
      {picked && shown && shown !== picked && (
        <div className={s.note}>
          drawn as <span className="mono">{shown}</span> here, to read on every surface
        </div>
      )}
      {near.length > 0 && (
        <div className={s.note}>
          close to the {near.map((n) => STATE_WORD[n]).join(' and ')} colour; states keep their own colour and word
        </div>
      )}
    </div>
  );
}

function BaseHue(props: { choice: Choice; colors: Record<string, string>; onChange: (v: number | null) => void }) {
  const hue = props.choice.hue;
  const gradient = useMemo(() => hueGradient(), []);
  return (
    <div className={s.section}>
      <div className={s.head}>
        <span>base hue</span>
        <span className="readout">{hue === null ? 'theme’s' : `${Math.round(hue)}°`}</span>
      </div>
      <div className={s.row}>
        <input
          type="range"
          className={s.hue}
          style={{ background: gradient }}
          aria-label="base hue, degrees"
          min={0}
          max={359}
          step={1}
          value={hue ?? 0}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <span className={s.tint} style={{ background: props.colors['bg-2'], borderColor: props.colors['rule-strong'] }} aria-hidden="true" />
        <button type="button" className={s.reset} disabled={hue === null} onClick={() => props.onChange(null)}>
          reset
        </button>
      </div>
      <div className={s.note}>tints surfaces, rules and quiet text; states and the accent keep theirs</div>
    </div>
  );
}
