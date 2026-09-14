import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Notice.module.scss';

interface NoticeProps {
  tone?: 'warning' | 'error' | 'info';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** Inline, non-blocking message — e.g. stale data or a partially available backend. */
export function Notice({ tone = 'warning', title, children, action }: NoticeProps) {
  return (
    <div role="status" className={cx(styles.notice, styles[tone])}>
      <span className={styles.shape} aria-hidden />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children && <p className={styles.description}>{children}</p>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
