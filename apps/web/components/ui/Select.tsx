import type { SelectHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './Icon';
import styles from './Select.module.scss';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  controlSize?: 'sm' | 'md';
  invalid?: boolean;
}

/** Native select: keyboard, screen reader and mobile pickers work out of the box. */
export function Select({ controlSize = 'md', invalid, className, children, ...rest }: SelectProps) {
  return (
    <span className={cx(styles.wrapper, styles[controlSize], className)}>
      <select className={styles.select} aria-invalid={invalid || undefined} {...rest}>
        {children}
      </select>
      <Icon name="chevron-down" size={14} className={styles.chevron} />
    </span>
  );
}
