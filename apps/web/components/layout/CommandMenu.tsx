'use client';

import type {
  AlertMonitorListResponse,
  EndpointListResponse,
  HostListResponse,
  MonitorListResponse,
  ServiceListResponse,
} from '@minidog/types';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { hostHref } from '@/features/infrastructure/host';
import { queryCommands, searchCommands, type CommandItem } from '@/lib/command-search';
import { cx } from '@/lib/cx';
import { endpointHref, serviceHref } from '@/lib/links';
import { withRange } from '@/lib/range-href';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { NAV_PAGES } from './SidebarNav';
import styles from './CommandMenu.module.scss';

const OPEN_EVENT = 'minidog:open-command-menu';

/** Opens the command menu from anywhere, e.g. the top bar button. */
export function openCommandMenu(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * ⌘K on Apple devices, Ctrl+K elsewhere. Only the platform's own modifier is
 * taken: on macOS Ctrl+K in a text field deletes to the end of the line.
 */
function isApplePlatform(): boolean {
  return /mac|iphone|ipad/i.test(navigator.userAgent);
}

/** Mounted once in the shell: ⌘K / Ctrl+K toggles the menu; navigating closes it. */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const apple = isApplePlatform();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing) return;
      if ((apple ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return open ? <CommandDialog onClose={() => setOpen(false)} /> : null;
}

function CommandDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const range = useTimeRange();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Loaded when the menu opens; lists are small (a personal setup).
  const services = useApi<ServiceListResponse>('/services?range=24h', 60_000);
  const endpoints = useApi<EndpointListResponse>('/endpoints?range=24h', 60_000);
  const hosts = useApi<HostListResponse>('/hosts?range=24h', 60_000);
  const synthetics = useApi<MonitorListResponse>('/monitors?range=1h', 60_000);
  const alerts = useApi<AlertMonitorListResponse>('/alerting/monitors', 60_000);
  const loading = [services, endpoints, hosts, synthetics, alerts].some((source) => source.isLoading);

  const items = useMemo<CommandItem[]>(
    () => [
      ...NAV_PAGES.map((page) => ({ id: `page:${page.href}`, kind: 'page' as const, label: page.label, href: withRange(page.href, range) })),
      ...(services.data?.services ?? []).map((service) => ({
        id: `service:${service.service}`,
        kind: 'service' as const,
        label: service.service,
        detail: service.health,
        href: serviceHref(service.service, range),
      })),
      ...(endpoints.data?.endpoints ?? []).map((endpoint) => ({
        id: `endpoint:${endpoint.service}:${endpoint.endpoint}`,
        kind: 'endpoint' as const,
        label: endpoint.endpoint,
        detail: endpoint.service,
        href: endpointHref(endpoint.service, endpoint.endpoint, range),
      })),
      ...(hosts.data?.hosts ?? []).map((host) => ({
        id: `host:${host.host}`,
        kind: 'host' as const,
        label: host.host,
        detail: host.os ?? undefined,
        href: hostHref(host.host, range),
      })),
      ...(synthetics.data?.monitors ?? []).map((monitor) => ({
        id: `synthetic:${monitor.id}`,
        kind: 'monitor' as const,
        label: monitor.name,
        detail: monitor.url,
        href: withRange(`/synthetics/${monitor.id}`, range),
      })),
      ...(alerts.data?.monitors ?? []).map((monitor) => ({
        id: `alert:${monitor.id}`,
        kind: 'monitor' as const,
        label: monitor.name,
        detail: 'Alert monitor',
        href: withRange(`/monitors/${monitor.id}`, range),
      })),
    ],
    [alerts.data, endpoints.data, hosts.data, range, services.data, synthetics.data],
  );

  const groups = useMemo(
    () => searchCommands([...items, ...queryCommands(query).map((item) => ({ ...item, href: withRange(item.href, range) }))], query),
    [items, query, range],
  );
  const flat = groups.flatMap((group) => group.items);
  const activeIndex = Math.min(active, Math.max(flat.length - 1, 0));

  // Focus moves into the menu and returns where it was when the menu closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    // optionId is derived from the stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const open = (item: CommandItem) => {
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // While an input method composes (e.g. Hangul), Enter and Escape belong to
    // the composition, not to the menu.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const count = flat.length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      setActive((activeIndex + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      setActive((activeIndex - 1 + count) % count);
    } else if (event.key === 'Enter') {
      const item = flat[activeIndex];
      if (item) {
        event.preventDefault();
        open(item);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      // The input is the only focus stop, so focus stays inside the dialog.
      event.preventDefault();
    }
  };

  let index = -1;
  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Search">
        <div className={styles.inputRow}>
          <Icon name="search" className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search services, endpoints, hosts, monitors — or paste a trace id"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length > 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className={styles.list}>
          {groups.map((group) => (
            <div key={group.kind} role="group" aria-label={group.label}>
              <p className={styles.groupLabel} aria-hidden>
                {group.label}
              </p>
              {group.items.map((item) => {
                index += 1;
                const position = index;
                return (
                  <div
                    key={item.id}
                    id={optionId(position)}
                    role="option"
                    aria-selected={position === activeIndex}
                    className={cx(styles.option, position === activeIndex && styles.active)}
                    onMouseMove={() => setActive(position)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => open(item)}
                  >
                    <span className={styles.label}>{item.label}</span>
                    {item.detail && <span className={styles.detail}>{item.detail}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <p className={styles.empty}>{loading ? 'Loading…' : `Nothing matches “${query.trim()}”.`}</p>}
        </div>

        <div className={styles.footer}>
          <span aria-live="polite">
            {flat.length} result{flat.length === 1 ? '' : 's'}
          </span>
          <span>↑↓ to move · Enter to open</span>
        </div>
      </div>
    </div>
  );
}

/** Top bar button; shows ⌘K on Apple devices and Ctrl K elsewhere. */
export function CommandMenuTrigger() {
  const [apple, setApple] = useState(false);
  useEffect(() => setApple(isApplePlatform()), []);
  return (
    <button type="button" className={styles.trigger} onClick={openCommandMenu} aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}>
      <Icon name="search" size={14} />
      <span className={styles.triggerLabel}>Search</span>
      <kbd className={styles.kbd}>{apple ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
