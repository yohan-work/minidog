'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';
import styles from './FilterBar.module.scss';

/** One row of filters under the page header; wraps on narrow screens. */
export function FilterBar({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className={styles.bar} role="group" aria-label="Filters">
      <div className={styles.controls}>{children}</div>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.control}>
      <span className={styles.visuallyHidden}>{label}</span>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** Text filter that applies 300 ms after typing stops. */
export function SearchField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => onChange(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <label className={cx(styles.control, styles.search)}>
      <span className={styles.visuallyHidden}>{label}</span>
      <Input type="search" value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} />
    </label>
  );
}

/** An applied filter that is not a select, e.g. a trace id from a link. */
export function FilterChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipValue}>{value}</span>
      <button type="button" className={styles.chipClear} onClick={onClear} aria-label={`Remove ${label} filter`}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}
