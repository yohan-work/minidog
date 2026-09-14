'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { ServiceMapNode, ServiceMapResponse, TimeRange } from '@minidog/types';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { Skeleton } from '@/components/ui/Skeleton';
import { RowLink, Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatLatency, formatPercent, formatRate } from '@/lib/format';
import { serviceHref } from '@/lib/links';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { errorRateTone, toneClass } from './ServiceTable';
import { TelemetrySetup } from './TelemetrySetup';
import styles from './ServiceMap.module.scss';

type MapNodeData = ServiceMapNode & Record<string, unknown>;

/** Node width (192 px) plus room for an edge label between columns. */
const COLUMN_GAP = 340;
const ROW_GAP = 132;

/**
 * Nodes in columns by call depth: callers on the left, each dependency one
 * column right of its deepest caller, so edges never pass through a node.
 */
function layout(nodes: readonly ServiceMapNode[], edges: ServiceMapResponse['edges']): Map<string, { x: number; y: number }> {
  const incoming = new Set(edges.map((edge) => edge.target));
  const depth = new Map<string, number>();
  const queue = nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
  for (const id of queue) depth.set(id, 0);
  // Longest path from a root; bounded so cycles terminate.
  while (queue.length > 0) {
    const id = queue.shift()!;
    const next = depth.get(id)! + 1;
    if (next >= nodes.length) continue;
    for (const edge of edges) {
      if (edge.source === id && (depth.get(edge.target) ?? -1) < next) {
        depth.set(edge.target, next);
        queue.push(edge.target);
      }
    }
  }

  const columns = new Map<number, ServiceMapNode[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const tallest = Math.max(...[...columns.values()].map((column) => column.length));
  for (const [column, members] of columns) {
    members.sort((a, b) => a.name.localeCompare(b.name));
    const offset = ((tallest - members.length) * ROW_GAP) / 2;
    members.forEach((node, index) => positions.set(node.id, { x: column * COLUMN_GAP, y: offset + index * ROW_GAP }));
  }
  return positions;
}

function MapNodeView({ data }: NodeProps<Node<MapNodeData>>) {
  return (
    <div className={styles.node} data-kind={data.kind} data-health={data.health}>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.nodeTitle}>
        {data.kind === 'database' ? (
          <>
            <span className={styles.kind}>DB</span>
            <span className={styles.nodeName}>{data.name}</span>
          </>
        ) : (
          <StatusIndicator status={data.health} label={data.name} />
        )}
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>{data.kind === 'database' ? 'Queries' : 'Requests'}</dt>
          <dd>{formatRate(data.requestsPerSecond, '/s')}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd className={toneClass(errorRateTone(data.errorRate))}>{formatPercent(data.errorRate, 1)}</dd>
        </div>
        <div>
          <dt>P95</dt>
          <dd>{formatLatency(data.p95Ms)}</dd>
        </div>
      </dl>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { service: MapNodeView };

const COLUMNS = [
  { label: 'Caller' },
  { label: 'Called' },
  { label: 'Calls', align: 'end' },
  { label: 'Error rate', align: 'end' },
  { label: 'P95', align: 'end' },
] as const satisfies readonly ColumnSpec[];

export function ServiceMapView() {
  const range = useTimeRange();
  const router = useRouter();
  const { data, error, isLoading, updatedAt, refetch } = useApi<ServiceMapResponse>(`/service-map?range=${range}`, 30_000);

  const graph = useMemo(() => {
    if (!data) return null;
    const positions = layout(data.nodes, data.edges);
    const nodes: Node<MapNodeData>[] = data.nodes.map((node) => ({
      id: node.id,
      type: 'service',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: node as MapNodeData,
      draggable: true,
      selectable: node.kind === 'service',
    }));
    const edges: Edge[] = data.edges.map((edge) => {
      const failing = errorRateTone(edge.errorRate) !== undefined;
      return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: `${formatRate(edge.callsPerSecond, '/s')} · ${formatLatency(edge.p95Ms)}`,
        className: failing ? styles.failingEdge : styles.edge,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
      };
    });
    return { nodes, edges };
  }, [data]);

  const nameOf = (id: string) => data?.nodes.find((node) => node.id === id)?.name ?? id;

  return (
    <>
      <PageHeader title="Service map" back={{ href: withRange('/services', range), label: 'Services' }} />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {isLoading ? (
        <Section title="Dependencies">
          <Skeleton height="calc(var(--chart-height) * 2)" />
        </Section>
      ) : !data || !graph ? (
        <ErrorState title="Unable to load the service map." description={error?.message} onRetry={refetch} />
      ) : data.nodes.length === 0 ? (
        <EmptyState
          title="No services in this range"
          description="The map is built from trace context: calls between services and database client spans."
          action={<TelemetrySetup />}
        />
      ) : (
        <>
          <Section title="Dependencies" actions={<span className={styles.note}>Drag to rearrange · click a service to open it</span>} flush>
            <div className={styles.canvas} role="img" aria-label={`Service map with ${data.nodes.length} nodes and ${data.edges.length} dependencies. The table below lists every dependency.`}>
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={NODE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.3}
                maxZoom={1.5}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_event, node) => {
                  if ((node.data as MapNodeData).kind === 'service') router.push(serviceHref(node.id, range));
                }}
              >
                <Background gap={24} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </Section>

          <Section title="Calls" flush>
            {data.edges.length > 0 ? (
              <DependencyTable data={data} range={range} nameOf={nameOf} />
            ) : (
              <p className={styles.empty}>No calls between services in this range. Services link up when trace context is propagated.</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function DependencyTable({ data, range, nameOf }: { data: ServiceMapResponse; range: TimeRange; nameOf: (id: string) => string }) {
  const kinds = new Map(data.nodes.map((node) => [node.id, node.kind]));
  return (
    <Table aria-label="Service dependencies">
      <TableHead columns={COLUMNS} />
      <tbody>
        {[...data.edges]
          .sort((a, b) => b.calls - a.calls)
          .map((edge) => (
            <Tr key={`${edge.source}->${edge.target}`} interactive>
              <Td>
                <RowLink href={serviceHref(edge.source, range)}>{nameOf(edge.source)}</RowLink>
              </Td>
              <Td>{kinds.get(edge.target) === 'database' ? `${nameOf(edge.target)} (database)` : nameOf(edge.target)}</Td>
              <Td align="end" mono>
                {formatRate(edge.callsPerSecond, '/s')}
              </Td>
              <Td align="end" mono className={toneClass(errorRateTone(edge.errorRate))}>
                {formatPercent(edge.errorRate)}
              </Td>
              <Td align="end" mono>
                {formatLatency(edge.p95Ms)}
              </Td>
            </Tr>
          ))}
      </tbody>
    </Table>
  );
}
