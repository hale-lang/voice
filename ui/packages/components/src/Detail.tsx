import { createContext, useContext } from 'react';

/**
 * Where an item opened from a list shows: on a page of its own (the list
 * kept, hidden, behind a back link), in a drawer over the list, or in place,
 * a full-width row under the row clicked.
 */
export type DetailLayout = 'page' | 'drawer' | 'inline';

export const DETAIL_LAYOUTS: { value: DetailLayout; label: string }[] = [
  { value: 'page', label: 'full page' },
  { value: 'drawer', label: 'drawer' },
  { value: 'inline', label: 'in place' },
];

/** What a table reads to show the open item under its row, in place. */
export type DetailState = {
  layout: DetailLayout;
  node: React.ReactNode;
  // the row last clicked: the table it is in, and its key
  clicked: { table: string; key: string } | null;
  click: (table: string, key: string) => void;
  // a table showing the item in place says so, so it is not shown twice
  claim: (table: string, on: boolean) => void;
};

export const DetailContext = createContext<DetailState | null>(null);

export function useDetail(): DetailState | null {
  return useContext(DetailContext);
}
