import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Section.module.scss';

interface SectionProps {
  title: ReactNode;
  actions?: ReactNode;
  /** No body padding — for tables that align their own cells. */
  flush?: boolean;
  children: ReactNode;
}

/** Border-separated section. Dashboards are sections and dividers, not stacks of cards. */
export function Section({ title, actions, flush = false, children }: SectionProps) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      <div className={cx(styles.body, flush && styles.flush)}>{children}</div>
    </section>
  );
}
