import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Badge.module.scss';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  tone?: BadgeTone;
  mono?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', mono, children, className }: BadgeProps) {
  return <span className={cx(styles.badge, styles[tone], mono && styles.mono, className)}>{children}</span>;
}
