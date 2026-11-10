export type Scheme = 'light' | 'dark';

export interface Theme {
  name: string;
  label: string;
  scheme: Scheme;
  pair: string | null;
  contrast: number;
  color: Record<string, string>;
  hue: Record<string, string>;
}

export interface Choice {
  theme: string;
  follow: boolean;
  accent: string | null;
  hue: number | null;
}

export interface ContrastRule {
  fg: string;
  bg: string;
  min: number;
}

export const THEMES: Theme[];
export const DEFAULT_THEME: string;
export const SURFACES: string[];
export const TEXT: string[];
export const STATES: { ok: string; wait: string; fail: string };
export const SIGNALS: string[];
export const ACCENT: string[];
export const FAINT: number;
export const GRAPHIC: number;
export const ACCENT_TOKENS: string[];
export const BASE_TOKENS: string[];
export const CUSTOM_PROPERTIES: string[];

export function themeNamed(name: string): Theme;
export function contrastRules(theme: Theme): ContrastRule[];
export function contrastFailures(colors: Record<string, string>, theme: Theme): (ContrastRule & { ratio: number })[];
export function deriveAccent(input: string, colors: Record<string, string>, theme: Theme): Record<string, string>;
export function deriveBase(hue: number, colors: Record<string, string>, theme: Theme): Record<string, string>;
export function customColors(choice: Choice, theme: Theme): { colors: Record<string, string>; vars: Record<string, string> };
export function nearStates(color: string, colors: Record<string, string>): ('ok' | 'wait' | 'fail')[];
export function defaultChoice(): Choice;
export function followPair(choice: Choice): { light: string; dark: string };
export function resolveTheme(choice: Choice, prefersLight: boolean): string;
export function readChoice(key: string, storage?: Pick<Storage, 'getItem'> | null): Choice;
export function writeChoice(key: string, choice: Choice, storage?: Pick<Storage, 'setItem'> | null): boolean;
export function applyTheme(root: HTMLElement, name: string, vars: Record<string, string>): void;
export function hueGradient(): string;
