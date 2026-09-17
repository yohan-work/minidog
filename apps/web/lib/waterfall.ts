import type { SpanDetail } from '@minidog/types';

export interface WaterfallRow {
  span: SpanDetail;
  depth: number;
  /** Position within the trace, percent. */
  offsetPct: number;
  widthPct: number;
  /** Time not covered by child spans. */
  selfMs: number;
  /** Direct children; 0 for a leaf. */
  childCount: number;
  /** Everything below this span, at any depth. */
  descendantCount: number;
}

export interface WaterfallModel {
  rows: WaterfallRow[];
  startMs: number;
  durationMs: number;
  /** Span with the most self time — where the request actually waited. */
  slowestSpanId: string | null;
}

/** Orders spans depth-first by start time; spans whose parent is missing become roots. */
export function buildWaterfall(spans: readonly SpanDetail[]): WaterfallModel {
  const ids = new Set(spans.map((span) => span.spanId));
  const children = new Map<string, SpanDetail[]>();
  const roots: SpanDetail[] = [];
  for (const span of spans) {
    if (span.parentSpanId && ids.has(span.parentSpanId)) {
      const siblings = children.get(span.parentSpanId) ?? [];
      siblings.push(span);
      children.set(span.parentSpanId, siblings);
    } else {
      roots.push(span);
    }
  }
  const byStart = (a: SpanDetail, b: SpanDetail) => a.startMs - b.startMs;
  roots.sort(byStart);
  for (const list of children.values()) list.sort(byStart);

  const startMs = Math.min(...spans.map((span) => span.startMs));
  const endMs = Math.max(...spans.map((span) => span.startMs + span.durationMs));
  const durationMs = Math.max(endMs - startMs, 0.001);

  const rows: WaterfallRow[] = [];
  const visit = (span: SpanDetail, depth: number): number => {
    const kids = children.get(span.spanId) ?? [];
    const row: WaterfallRow = {
      span,
      depth,
      offsetPct: ((span.startMs - startMs) / durationMs) * 100,
      widthPct: Math.max((span.durationMs / durationMs) * 100, 0.3),
      selfMs: selfTime(span, kids),
      childCount: kids.length,
      descendantCount: 0,
    };
    rows.push(row);
    for (const child of kids) row.descendantCount += 1 + visit(child, depth + 1);
    return row.descendantCount;
  };
  for (const root of roots) visit(root, 0);

  const slowest = rows.length > 1 ? rows.reduce((worst, row) => (row.selfMs > worst.selfMs ? row : worst)) : null;
  return { rows, startMs, durationMs, slowestSpanId: slowest?.span.spanId ?? null };
}

export interface VisibleRow extends WaterfallRow {
  /** Whether the span itself matches the search; ancestors of a match are shown dimmed. */
  matches: boolean;
  collapsed: boolean;
}

/** Case-insensitive match on the span's service, name and status message. */
export function matchesSpan(span: SpanDetail, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [span.service, span.name, span.statusMessage, span.httpRoute].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

/**
 * The rows to draw. Collapsed spans hide everything below them. A search
 * shows the spans that match and the path down to each of them, and ignores
 * collapsing, so a match is never hidden.
 */
export function visibleRows(
  model: WaterfallModel,
  options: { collapsed: ReadonlySet<string>; query: string },
): VisibleRow[] {
  const searching = options.query.trim() !== '';
  if (!searching) {
    const shown: VisibleRow[] = [];
    let hideBelow: number | null = null;
    for (const row of model.rows) {
      if (hideBelow !== null && row.depth > hideBelow) continue;
      hideBelow = null;
      const collapsed = row.childCount > 0 && options.collapsed.has(row.span.spanId);
      if (collapsed) hideBelow = row.depth;
      shown.push({ ...row, matches: true, collapsed });
    }
    return shown;
  }

  const parents = new Map(model.rows.map((row) => [row.span.spanId, row.span.parentSpanId]));
  const keep = new Set<string>();
  const matched = new Set<string>();
  for (const row of model.rows) {
    if (!matchesSpan(row.span, options.query)) continue;
    matched.add(row.span.spanId);
    for (let id: string | undefined = row.span.spanId; id && !keep.has(id); id = parents.get(id)) keep.add(id);
  }
  return model.rows
    .filter((row) => keep.has(row.span.spanId))
    .map((row) => ({ ...row, matches: matched.has(row.span.spanId), collapsed: false }));
}

/** Duration minus the union of child intervals clipped to the span. */
export function selfTime(span: SpanDetail, children: readonly SpanDetail[]): number {
  const start = span.startMs;
  const end = span.startMs + span.durationMs;
  const intervals = children
    .map((child) => [Math.max(child.startMs, start), Math.min(child.startMs + child.durationMs, end)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let current: [number, number] | null = null;
  for (const [from, to] of intervals) {
    if (current && from <= current[1]) {
      current[1] = Math.max(current[1], to);
    } else {
      if (current) covered += current[1] - current[0];
      current = [from, to];
    }
  }
  if (current) covered += current[1] - current[0];
  return Math.max(span.durationMs - covered, 0);
}
