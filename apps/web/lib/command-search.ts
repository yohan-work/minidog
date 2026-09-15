import { toQuery } from './query-params';

/** What a result opens. `trace` and `search` come from the typed text itself. */
export type CommandKind = 'trace' | 'page' | 'service' | 'endpoint' | 'host' | 'monitor' | 'search';

export interface CommandItem {
  /** Unique across all items. */
  id: string;
  kind: CommandKind;
  /** Matched first and shown prominently. */
  label: string;
  /** Secondary text, also matched (e.g. the service of an endpoint). */
  detail?: string;
  href: string;
}

export interface CommandGroup {
  kind: CommandKind;
  label: string;
  items: CommandItem[];
}

// A pasted trace id goes first; "search logs/traces for …" is the fallback at the end.
const KIND_ORDER: readonly CommandKind[] = ['trace', 'page', 'service', 'endpoint', 'host', 'monitor', 'search'];

const KIND_LABELS: Record<CommandKind, string> = {
  trace: 'Trace',
  page: 'Pages',
  service: 'Services',
  endpoint: 'Endpoints',
  host: 'Hosts',
  monitor: 'Monitors',
  search: 'Search',
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 0 exact · 1 prefix · 2 start of a word · 3 anywhere in the label · 4 in the detail · null no match. */
export function matchScore(item: CommandItem, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 3;
  const label = item.label.toLowerCase();
  if (label === needle) return 0;
  if (label.startsWith(needle)) return 1;
  if (new RegExp(`[\\s/._:-]${escapeRegExp(needle)}`).test(label)) return 2;
  if (label.includes(needle)) return 3;
  if (item.detail?.toLowerCase().includes(needle)) return 4;
  return null;
}

/**
 * Matching items grouped by kind in a fixed order, best matches first. With
 * no query, items keep their given order (the navigation order for pages).
 */
export function searchCommands(items: readonly CommandItem[], query: string): CommandGroup[] {
  const typed = query.trim() !== '';
  const perGroup = typed ? 6 : 4;
  const scored = items.flatMap((item) => {
    const score = matchScore(item, query);
    return score === null ? [] : [{ item, score }];
  });
  return KIND_ORDER.flatMap((kind) => {
    const matches = scored
      .filter((entry) => entry.item.kind === kind)
      .sort((a, b) => a.score - b.score || (typed ? a.item.label.localeCompare(b.item.label) : 0))
      .slice(0, kind === 'page' && !typed ? Number.POSITIVE_INFINITY : perGroup)
      .map((entry) => entry.item);
    return matches.length > 0 ? [{ kind, label: KIND_LABELS[kind], items: matches }] : [];
  });
}

const TRACE_ID = /^[0-9a-f]{32}$/i;

/** Results made from the typed text: open a pasted trace id, or search logs and traces for it. */
export function queryCommands(query: string): CommandItem[] {
  const text = query.trim();
  if (!text) return [];
  if (TRACE_ID.test(text)) {
    const traceId = text.toLowerCase();
    return [{ id: 'trace', kind: 'trace', label: `Open trace ${traceId}`, href: `/traces/${traceId}` }];
  }
  return [
    { id: 'search:logs', kind: 'search', label: `Search logs for “${text}”`, href: `/logs${toQuery({ q: text })}` },
    {
      id: 'search:traces',
      kind: 'search',
      label: `Search traces for “${text}”`,
      href: `/traces${toQuery({ q: text })}`,
    },
  ];
}
