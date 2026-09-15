# minidog 실행 가이드

`docs/phase-01.md` 기획서의 V0.1 범위를 구현한 상태를 기준으로 한다.

## 구성

```text
Application (OpenTelemetry SDK)
     │ OTLP (4317 gRPC / 4318 HTTP)
     ▼
OpenTelemetry Collector ── host_metrics (CPU · Memory · Disk · Network)
     │ OTLP/HTTP JSON  POST /v1/{traces,metrics,logs}
     ▼
Ingestion API (Fastify, :4000) ── API key → project / environment
     │
     ▼
ClickHouse (spans · logs · metrics · synthetic_results)     SQLite (projects · monitors · API keys)
     │                                                        │
     └──────────────── Query API (:4000/api) ─────────────────┘
                              │
                              ▼
                   Web Dashboard (Next.js, :3000)
```

- 백그라운드 작업(합성 체크 스케줄러, 알림 평가기)은 API 프로세스 안에서 실행된다.
- 텔레메트리 보관 기간: spans·logs 14일, metrics 30일, synthetic results 90일.

## 준비

- Node.js 24 이상, pnpm 10, Docker

## 실행

```bash
pnpm install
pnpm infra:up      # ClickHouse + OpenTelemetry Collector
pnpm dev           # API :4000 + Web :3000
```

`http://localhost:3000` 을 연다.

### 샘플 데이터

```bash
pnpm demo          # web → api → (postgres.query, payment) 3개 서비스 + 트래픽
```

데모는 `http://localhost:4318`(Collector)로 traces · logs · metrics를 보낸다.
동작은 실행 중에 바꿀 수 있다.

```bash
curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":300}'        # DB 지연을 단계적으로 올리기
curl -X POST localhost:5100/__demo/scenario -d '{"slowDb":true}'          # 주문 INSERT ~580 ms
curl -X POST localhost:5100/__demo/scenario -d '{"paymentErrorRate":0.2}' # 결제 실패 20%
curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":null,"slowDb":false,"paymentErrorRate":0.02}'
```

## 텔레메트리 연결

| 경로 | 설정 |
| --- | --- |
| SDK → 번들 Collector | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` |
| SDK → Ingestion API 직접 | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` |
| 다른 Collector | `otlp_http` exporter, `endpoint: http://<api>:4000`, `encoding: json` |

- Ingestion API는 OTLP/HTTP **JSON** 만 받는다(gzip 가능). protobuf 요청은 415로 거절된다.
- 서비스 이름은 `service.name`, 호스트는 `host.name`, 환경은 `deployment.environment.name` 리소스 속성에서 읽는다.

### API key

Settings → API keys 에서 환경별 키를 만든다. 키는 만들 때 한 번만 표시되고 해시만 저장된다.

- 요청 헤더 `x-minidog-api-key: <key>` 또는 `Authorization: Bearer <key>`
- 번들 Collector: `MINIDOG_API_KEY=<key> pnpm infra:up`
- 키 없이 들어온 데이터는 기본 프로젝트(첫 프로젝트의 첫 환경)에 저장된다. `INGEST_REQUIRE_API_KEY=true` 이면 401.
- 폐기한 키와 잘못된 키는 401.

### 리눅스 서버의 호스트 지표

Docker Desktop에서는 Docker VM의 지표가 보인다. 실제 서버를 보려면 Collector 컨테이너에
`/:/hostfs:ro` 를 마운트하고 `host_metrics.root_path: /hostfs`, `network_mode: host` 를 설정한다
(`infra/otel/collector.yaml` 주석 참고).

## API 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` / `HOST` | `4000` / `127.0.0.1` | API 주소 |
| `SQLITE_PATH` | `./data/minidog.sqlite` | 메타데이터 DB |
| `CLICKHOUSE_URL` · `_USER` · `_PASSWORD` · `_DATABASE` | compose 값 | 텔레메트리 저장소 |
| `WORKER_ENABLED` | `true` | 합성 체크 스케줄러 |
| `ALERTS_ENABLED` / `ALERT_INTERVAL_SECONDS` | `true` / `30` | 모니터 평가 주기 |
| `INGEST_REQUIRE_API_KEY` | `false` | 키 없는 OTLP 요청 거절 |
| `PUBLIC_API_URL` / `PUBLIC_COLLECTOR_URL` | `http://localhost:4000` / `:4318` | Settings에 보이는 연결 정보 |

웹은 `API_URL`(기본 `http://127.0.0.1:4000`)로 `/api/*` 를 프록시한다. 빌드 시점에 읽힌다.

## 화면

```text
Overview                 상태 요약 · 주의가 필요한 항목 · 처리량/지연 · 서비스/호스트/합성 체크
Observe
 ├ Services              서비스 목록 · 상세(P50/P95/P99, 엔드포인트, 최근 트레이스) · Service map · 배포 표시선(service.version) · 버전별 비교 · 엔드포인트 상세(응답시간 분포)
 ├ Infrastructure        호스트 목록 · 상세(CPU/Memory/Disk/Network)
 ├ Metrics               지표 · 집계 · 서비스/호스트 필터 · 그룹
 ├ Traces                Trace Explorer · Trace 상세(Waterfall, 느린 span, 관련 로그) · 느린 순 정렬
 ├ Errors                예외(type+message) 묶음 · 영향받은 트레이스 수 · 엔드포인트 · 처음/마지막 발생
 ├ Queries               DB 쿼리 순위(총 소요 시간 · P95 · 호출 수, 값은 ? 로 묶음) · 가장 느린 호출의 트레이스로 이동
 └ Logs                  Log Explorer(서비스/레벨/검색/trace id) → Trace
Monitor
 ├ Synthetics            URL 체크(상태 코드, 지연, 가용성, SSL 만료)
 └ Monitors              Service down · Error rate · Latency · CPU/Memory · Synthetic check(실패율 · 응답 시간 · SSL 만료),
                         상태 이력, Webhook(Slack 호환), N분 지속 시 알림 · 해제 지연 · 음소거
Settings                 프로젝트 · 환경 · API key · 연결 정보
```

상단 바에서 프로젝트/환경과 시간 범위를 바꾼다. 요청·지연 차트를 드래그하면 그 구간의 느린 트레이스 · 에러 트레이스 · 에러 로그 · 예외로 바로 이동한다. 경고·위험 모니터가 있으면 알림 표시가 나타난다.

## MVP 완료 기준 확인

| 시나리오 | 확인 방법 |
| --- | --- |
| A. URL 모니터 | Synthetics → New monitor → `https://example.com`. 상세에서 Status · Uptime · Latency · History |
| B. Node.js OTel | `pnpm demo` → Services → `api` → Endpoints `POST /checkout` → Trace → Span |
| C. 에러 트레이스 → 로그 | Traces에서 Status: Errors → 트레이스 → Related logs (Logs 화면의 trace 링크로 역방향) |
| D. Latency 모니터 | Monitors → New monitor(Latency, `api`, warning 250 ms, critical 500 ms, 1 min) → `dbDelayMs` 200 → 600. 이력에 Healthy → Warning → Critical |
| E. URL 다운 알림 | Synthetics → 모니터 상세 → Create alert(Synthetic check · Failed checks, Webhook URL). 다운되면 Critical로 바뀌고 Webhook이 간다. Alert after를 고르면 그 시간 동안 계속될 때만, Mute 중에는 기록만 하고 해제 후 한 번 보낸다 |
| F. 구간 드릴다운 · Errors | `pnpm demo` 후 `curl -X POST localhost:5100/__demo/scenario -d '{"paymentErrorRate":0.5,"dbDelayMs":300}'` → Services 요청 차트를 드래그 → Slowest traces / Exceptions. Errors에 `card declined by issuer`가 묶여 보인다 |
| G. 배포 표시선 | `pnpm demo`를 끄고 `DEMO_VERSION=1.1.0 pnpm demo`로 다시 실행 → 서비스 차트에 `1.1.0` 세로선, 서비스 상세 Versions에 1.0.0 / 1.1.0 비교 |
| H. 느린 DB 쿼리 | `pnpm demo` 후 `curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":300}'` → Queries에서 `INSERT INTO orders …`가 총 소요 시간 1위, 행을 누르면 가장 느린 호출의 트레이스 |
| I. 엔드포인트 상세 | Services → `api` → Endpoints에서 `POST /checkout` → 응답시간 분포(2배 간격 막대, 빨강 = 실패), P50/P95/P99 표시, 가장 느린 요청 |

## 개발

```bash
pnpm typecheck
pnpm test          # API 단위 테스트 (node:test)
pnpm build
```
