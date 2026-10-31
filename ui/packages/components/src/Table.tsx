import type { ReactNode } from 'react';
import s from './Table.module.css';
import { Fragment, useEffect, useId } from 'react';
import { useDetail } from './Detail';

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Right-aligned with tabular numerals. */
  num?: boolean;
  /** Prose that may wrap; cells do not wrap by default, so ids stay whole. */
  wrap?: boolean;
  render: (row: T) => ReactNode;
};

/** Dense, precise lookup. Numbers are the content; they line up. */
export function Table<T>(props: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  selectedKey?: string;
  onSelect?: (row: T) => void;
  /** Class per row, e.g. an afterglow for a fresh failure. */
  rowClass?: (row: T) => string | undefined;
  empty?: ReactNode;
}) {
  const selectable = !!props.onSelect;
  const detail = useDetail();
  const table = useId();
  // in place, the open item is a row under the row clicked, in this table
  const here =
    detail?.layout === 'inline' &&
    detail.node != null &&
    detail.clicked?.table === table &&
    detail.clicked.key === props.selectedKey &&
    props.rows.some((r) => props.rowKey(r) === props.selectedKey);
  useEffect(() => {
    detail?.claim(table, !!here);
    return () => detail?.claim(table, false);
  }, [here, table]);
  const select = (row: T) => {
    detail?.click(table, props.rowKey(row));
    props.onSelect!(row);
  };
  return (
    <div className={s.wrap}>
    <table className={`${s.table} ${selectable ? s.selectable : ''}`}>
      <thead>
        <tr>
          {props.columns.map((c) => (
            <th key={c.key} className={c.num ? s.num : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 && (
          <tr>
            <td colSpan={props.columns.length} className={s.empty}>
              {props.empty ?? 'Nothing here.'}
            </td>
          </tr>
        )}
        {props.rows.map((row) => {
          const k = props.rowKey(row);
          const cls = [props.rowClass?.(row), k === props.selectedKey ? s.selected : undefined]
            .filter(Boolean)
            .join(' ');
          return (
            <Fragment key={k}>
            <tr
              className={cls || undefined}
              onClick={props.onSelect ? () => select(row) : undefined}
              tabIndex={selectable ? 0 : undefined}
              onKeyDown={
                props.onSelect
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(row);
                      }
                    }
                  : undefined
              }
              aria-selected={selectable ? k === props.selectedKey : undefined}
            >
              {props.columns.map((c) => (
                <td key={c.key} className={c.num ? s.num : c.wrap ? s.wrapCell : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
            {here && k === props.selectedKey && (
              <tr className={s.expanded}>
                <td colSpan={props.columns.length}>{detail!.node}</td>
              </tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
