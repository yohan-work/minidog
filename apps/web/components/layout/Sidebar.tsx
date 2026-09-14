'use client';

import { usePathname } from 'next/navigation';
import { useTimeRange } from '@/lib/time-range';
import { SidebarFrame, SidebarNav } from './SidebarNav';

export function Sidebar() {
  const pathname = usePathname();
  const range = useTimeRange();
  return (
    <SidebarFrame>
      <SidebarNav pathname={pathname} range={range} />
    </SidebarFrame>
  );
}
