import type { TimeRange } from '@minidog/types';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { withRange } from '@/lib/range-href';
import styles from './Sidebar.module.scss';

interface NavItem {
  label: string;
  /** Items without href are part of the IA but not available yet. */
  href?: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { items: [{ label: 'Overview', href: '/' }] },
  {
    label: 'Observe',
    items: [
      { label: 'Services', href: '/services' },
      { label: 'Infrastructure', href: '/infrastructure' },
      { label: 'Metrics', href: '/metrics' },
      { label: 'Traces', href: '/traces' },
      { label: 'Errors', href: '/errors' },
      { label: 'Queries', href: '/queries' },
      { label: 'Logs', href: '/logs' },
    ],
  },
  {
    label: 'Monitor',
    items: [
      { label: 'Synthetics', href: '/synthetics' },
      { label: 'Monitors', href: '/monitors' },
    ],
  },
  { items: [{ label: 'Settings', href: '/settings' }] },
];

/** Every page in the navigation, in its order — also offered by the command menu. */
export const NAV_PAGES: readonly { label: string; href: string }[] = NAV.flatMap((group) =>
  group.items.flatMap((item) => (item.href ? [{ label: item.label, href: item.href }] : [])),
);

function isActive(href: string, pathname: string | null): boolean {
  if (pathname === null) return false;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Link href="/" className={styles.wordmark}>
          minidog
        </Link>
      </div>
      {children}
    </aside>
  );
}

/** Stateless so it can render as the server fallback before search params resolve. */
export function SidebarNav({ pathname, range }: { pathname: string | null; range: TimeRange }) {
  return (
    <nav aria-label="Primary" className={styles.nav}>
      {NAV.map((group, index) => (
        <div key={group.label ?? index} className={styles.group}>
          {group.label && <p className={styles.groupLabel}>{group.label}</p>}
          <ul className={styles.list}>
            {group.items.map((item) => (
              <li key={item.label} className={cx(!item.href && styles.unavailableItem)}>
                {item.href ? (
                  <Link
                    href={withRange(item.href, range)}
                    className={styles.item}
                    aria-current={isActive(item.href, pathname) ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className={cx(styles.item, styles.unavailable)} aria-disabled="true">
                    {item.label}
                    <span className={styles.soon}>
                      Soon<span className={styles.visuallyHidden}> — not available yet</span>
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
