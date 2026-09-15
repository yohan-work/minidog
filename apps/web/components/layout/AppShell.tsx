import { DEFAULT_TIME_RANGE } from '@minidog/types';
import { Suspense, type ReactNode } from 'react';
import { CommandMenu } from './CommandMenu';
import { Sidebar } from './Sidebar';
import { SidebarFrame, SidebarNav } from './SidebarNav';
import { TopBar, TopBarFallback } from './TopBar';
import styles from './AppShell.module.scss';

/** Grid shell: sidebar | top context bar over content. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <Suspense
        fallback={
          <SidebarFrame>
            <SidebarNav pathname={null} range={DEFAULT_TIME_RANGE} />
          </SidebarFrame>
        }
      >
        <Sidebar />
      </Suspense>
      <Suspense fallback={<TopBarFallback />}>
        <TopBar />
      </Suspense>
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      {/* ⌘K / Ctrl+K anywhere */}
      <Suspense>
        <CommandMenu />
      </Suspense>
    </div>
  );
}
