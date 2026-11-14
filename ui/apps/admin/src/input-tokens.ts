/**
 * A usage record's input tokens as the ledger has them: its engine's count,
 * or, for a request cut off before its seat reported any
 * (`input_tokens_estimated`), voice's estimate, never shown as a count.
 */
export function inputTokens(r: { input_tokens: number; input_tokens_estimated?: boolean }): string {
  const n = r.input_tokens.toLocaleString();
  return r.input_tokens_estimated ? `≈${n} (estimated)` : n;
}
