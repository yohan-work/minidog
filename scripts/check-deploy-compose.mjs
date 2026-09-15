// deploy/compose.yaml carries the ClickHouse and Collector configs inline, so
// users download a single file. This fails when they drift from infra/.
import { readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../deploy/compose.yaml', import.meta.url), 'utf8');
const sources = {
  'clickhouse-minidog': 'infra/clickhouse/config.d/minidog.xml',
  'clickhouse-low-memory': 'infra/clickhouse/config.d/low-memory.xml',
  'clickhouse-low-memory-users': 'infra/clickhouse/users.d/low-memory.xml',
  collector: 'infra/otel/collector.yaml',
};

let stale = 0;
for (const [name, path] of Object.entries(sources)) {
  // Indented under `content: |`, with `$` doubled so compose does not interpolate it.
  const expected = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replaceAll('$', '$$$$')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line ? `      ${line}` : ''))
    .join('\n');
  if (!compose.includes(`  ${name}:\n    content: |\n${expected}\n`)) {
    console.error(`deploy/compose.yaml: config "${name}" differs from ${path}`);
    stale += 1;
  }
}
if (stale > 0) process.exit(1);
console.log('deploy/compose.yaml configs match infra/');
