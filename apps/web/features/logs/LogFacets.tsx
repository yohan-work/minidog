'use client';

import type { LogFacet } from '@minidog/types';
import { Section } from '@/components/layout/Section';
import { formatCount } from '@/lib/format';
import styles from './LogFacets.module.scss';

/**
 * The attribute keys in the matching records and their commonest values.
 * Clicking a value narrows the records to it; the counts are for the current
 * filters, so each click shows what the next one would leave.
 */
export function LogFacets({
  facets,
  active,
  full,
  onSelect,
  onRemove,
}: {
  facets: readonly LogFacet[];
  /** `key:value` filters already applied. */
  active: readonly string[];
  /** No more filters can be added. */
  full: boolean;
  onSelect: (key: string, value: string) => void;
  onRemove: (item: string) => void;
}) {
  return (
    <Section
      title="Attributes"
      actions={<span className={styles.note}>{full ? 'Filter limit reached' : 'Click a value to filter'}</span>}
    >
      <dl className={styles.facets}>
        {facets.map((facet) => (
          <div key={facet.key} className={styles.facet}>
            <dt className={styles.key} title={facet.key}>
              {facet.key}
              <span className={styles.count}>{formatCount(facet.count)}</span>
            </dt>
            <dd className={styles.values}>
              {facet.values.map(({ value, count }) => {
                const item = `${facet.key}:${value}`;
                const selected = active.includes(item);
                return (
                  <button
                    key={value}
                    type="button"
                    className={styles.value}
                    aria-pressed={selected}
                    disabled={!selected && full}
                    title={value}
                    onClick={() => (selected ? onRemove(item) : onSelect(facet.key, value))}
                  >
                    <span className={styles.valueText}>{value === '' ? '(empty)' : value}</span>
                    <span className={styles.count}>{formatCount(count)}</span>
                  </button>
                );
              })}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
