import type { SpanDetail } from '@minidog/types';

export interface WaterfallRow {
  span: SpanDetail;
  depth: number;
  /** Position within the trace, percent. */
  offsetPct: number;
  widthPct: number;
  /** Time not covered by child spans. */
  selfMs: number;
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
  const visit = (span: SpanDetail, depth: number) => {
    const kids = children.get(span.spanId) ?? [];
    rows.push({
      span,
      depth,
      offsetPct: ((span.startMs - startMs) / durationMs) * 100,
      widthPct: Math.max((span.durationMs / durationMs) * 100, 0.3),
      selfMs: selfTime(span, kids),
    });
    for (const child of kids) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);

  const slowest = rows.length > 1 ? rows.reduce((worst, row) => (row.selfMs > worst.selfMs ? row : worst)) : null;
  return { rows, startMs, durationMs, slowestSpanId: slowest?.span.spanId ?? null };
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
