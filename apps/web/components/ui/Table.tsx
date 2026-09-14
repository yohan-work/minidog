import Link from 'next/link';
import type { ComponentProps, HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import { Skeleton } from './Skeleton';
import styles from './Table.module.scss';

type Align = 'start' | 'end';
/** Hide low-priority columns on narrower viewports. */
type HideBelow = 'desktop' | 'tablet';

interface CellOptions {
  align?: Align;
  hideBelow?: HideBelow;
}

export interface ColumnSpec extends CellOptions {
  label: string;
}

const cellClass = ({ align = 'start', hideBelow }: CellOptions) =>
  cx(
    align === 'end' && styles.end,
    hideBelow === 'desktop' && styles.hideBelowDesktop,
    hideBelow === 'tablet' && styles.hideBelowTablet,
  );

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className={styles.scroll}>
      <table className={cx(styles.table, className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

// The deprecated native `align` attribute is replaced by CellOptions.align.
type ThProps = Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> & CellOptions;

export function Th({ align, hideBelow, className, ...rest }: ThProps) {
  return <th scope="col" className={cx(styles.th, cellClass({ align, hideBelow }), className)} {...rest} />;
}

interface TdProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'>, CellOptions {
  /** Geist Mono with tabular numbers — for durations, codes, timestamps. */
  mono?: boolean;
  muted?: boolean;
}

export function Td({ align, hideBelow, mono, muted, className, ...rest }: TdProps) {
  return (
    <td
      className={cx(styles.td, cellClass({ align, hideBelow }), mono && styles.mono, muted && styles.muted, className)}
      {...rest}
    />
  );
}

export function Tr({ interactive, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cx(styles.tr, interactive && styles.interactive, className)} {...rest} />;
}

/** The primary link of a row; its hit area covers the whole row. */
export function RowLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return <Link className={cx(styles.rowLink, className)} {...rest} />;
}

export function TableHead({ columns }: { columns: readonly ColumnSpec[] }) {
  return (
    <thead>
      <tr>
        {columns.map((column) => (
          <Th key={column.label} align={column.align} hideBelow={column.hideBelow}>
            {column.label}
          </Th>
        ))}
      </tr>
    </thead>
  );
}

/** Same columns and row height as the loaded table, so data arrives without layout shift. */
export function TableSkeleton({
  columns,
  rows = 3,
  label,
}: {
  columns: readonly ColumnSpec[];
  rows?: number;
  label: string;
}) {
  return (
    <Table aria-label={label} aria-busy="true">
      <TableHead columns={columns} />
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <Tr key={row}>
            {columns.map((column) => (
              <Td key={column.label} align={column.align} hideBelow={column.hideBelow}>
                <Skeleton
                  width={column.align === 'end' ? 'var(--space-16)' : '60%'}
                  height="var(--text-secondary)"
                  className={column.align === 'end' ? styles.skeletonEnd : undefined}
                />
              </Td>
            ))}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
