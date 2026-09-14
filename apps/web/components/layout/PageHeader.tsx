import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import styles from './PageHeader.module.scss';

interface PageHeaderProps {
  title: ReactNode;
  back?: { href: string; label: string };
  /** Rendered next to the title, e.g. a StatusIndicator. */
  status?: ReactNode;
  /** One line of technical context under the title. */
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, back, status, meta, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {back && (
        <Link href={back.href} className={styles.back}>
          <Icon name="arrow-left" size={14} />
          {back.label}
        </Link>
      )}
      <div className={styles.row}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {status}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {meta && <div className={styles.meta}>{meta}</div>}
    </header>
  );
}
