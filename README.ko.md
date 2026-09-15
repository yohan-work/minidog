<div align="center">

# minidog

**사이드 프로젝트를 위한 셀프 호스팅 Observability**<br>
메트릭, 트레이스, 로그, 가용성 체크를 하나의 대시보드에서. OpenTelemetry와 ClickHouse 기반.

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![한국어](https://img.shields.io/badge/lang-한국어-blue)](README.ko.md)

![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-native-425CC7?logo=opentelemetry&logoColor=white)
![ClickHouse](https://img.shields.io/badge/ClickHouse-26.3-FFCC01?logo=clickhouse&logoColor=black)

</div>

---

minidog은 Datadog의 핵심 흐름을 개인 개발자와 소규모 팀에 맞게 줄인 도구입니다.

> **뭔가 느리다 → 어느 서비스 → 어느 엔드포인트 → 어느 span → 어느 로그 한 줄**

쿼리 언어를 배우지 않고도 세 화면 안에 원인에 도달하는 것이 목표입니다.

## 기능

- **Overview**: 모든 서비스의 상태를 한눈에 보여주고, *needs attention* 목록으로 문제 지점을 짚어줍니다.
- **APM**: 서비스·엔드포인트별 요청 수, 에러율, P50/P95/P99와 Trace Explorer, Span Waterfall을 제공합니다.
- **Logs**: 서비스와 레벨로 검색하고 필터링합니다. trace ID가 있는 로그는 해당 트레이스로 연결됩니다.
- **Correlation**: 트레이스에서 관련 로그로, 로그에서 트레이스로 이동합니다. 시간 범위와 필터가 화면 간에 유지됩니다.
- **Infrastructure**: OTel `hostmetrics` receiver로 호스트 CPU, 메모리, 디스크, 네트워크를 수집합니다.
- **Metrics Explorer**: 수집된 메트릭을 집계 방식과 필터를 골라 조회합니다.
- **Synthetics**: HTTP 체크로 상태 코드, 지연 시간, 가용성, SSL 만료일을 확인합니다.
- **Monitors**: service down, 에러율, 지연 시간, 호스트 리소스 알림을 제공합니다. Warning/Critical 단계, 상태 이력, Webhook을 지원합니다.
- **Service Map**: span 관계로 서비스 의존성 그래프를 만듭니다.
- **Projects**: 프로젝트, 환경, 수집용 API Key를 관리합니다.

## 빠른 시작

필요한 것: Node.js 24 이상, pnpm 10, Docker

```bash
git clone https://github.com/yohan-work/minidog.git
cd minidog
pnpm install

pnpm infra:up   # ClickHouse + OpenTelemetry Collector
pnpm dev        # API :4000, 대시보드 :3000
```

**http://localhost:3000** 을 열면 됩니다. 약 15초 안에 호스트 메트릭이 들어오기 시작합니다.

### 데모 데이터로 체험하기

```bash
pnpm demo
```

계측된 서비스 세 개(`web → api → payment`, 가상의 Postgres 포함)가 트래픽을 만들어냅니다. 실행 중에 장애를 주입해서 대시보드가 어떻게 반응하는지 볼 수 있습니다.

```bash
# DB 지연 + payment 에러 20%
curl -X POST localhost:5100/__demo/scenario -d '{"slowDb":true,"paymentErrorRate":0.2}'
```

## 내 서비스의 텔레메트리 보내기

minidog은 표준 OTLP를 받기 때문에 전용 SDK가 필요 없습니다. 어떤 OpenTelemetry SDK든 함께 제공되는 Collector를 가리키게 하면 됩니다.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-api
```

Node.js는 코드 수정 없이 자동 계측을 바로 쓸 수 있습니다.

```bash
npm i @opentelemetry/auto-instrumentations-node
node --require @opentelemetry/auto-instrumentations-node/register app.js
```

API Key 없이 보낸 데이터는 기본 프로젝트로 들어갑니다. 특정 프로젝트와 환경으로 보내려면 **Settings**에서 키를 만들고 요청마다 함께 보내세요.

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-minidog-api-key=<your-key>"
```

`Authorization: Bearer <key>` 형식도 받습니다. 키 없는 데이터를 거부하려면 `INGEST_REQUIRE_API_KEY=true`로 설정하세요.

## 아키텍처

```text
Your app ──OTLP──▶ OTel Collector ──OTLP/HTTP──▶ Ingestion API ──▶ ClickHouse
                   (+ host metrics)              (Fastify)          (spans, logs,
                                                     │               metrics, checks)
                                                     ├── SQLite (projects, monitors, keys)
                                                     ├── Synthetic worker
                                                     └── Alert evaluator
                                                     ▲
                                  Next.js dashboard ─┘  Query API
```

| 데이터 | 저장소 | 보관 기간 |
| --- | --- | --- |
| Span, 로그 | ClickHouse | 14일 |
| 메트릭 | ClickHouse | 30일 |
| Synthetic 결과 | ClickHouse | 90일 |
| 프로젝트, 모니터, API Key | SQLite | — |

테이블은 처음 실행할 때 자동으로 만들어집니다.

## 프로젝트 구조

```text
apps/
  api/          Fastify: OTLP 수집, Query API, synthetic worker, alert evaluator
  web/          Next.js 대시보드
packages/
  types/        공용 API 타입
  config/       공용 TypeScript 설정
examples/
  demo-shop/    장애 주입이 가능한 계측 데모 서비스
infra/
  docker/       ClickHouse + Collector용 Docker Compose
  otel/         Collector 파이프라인 설정
  clickhouse/   ClickHouse 서버 설정
docs/           제품·디자인 기획서
```

## 설정

두 앱 모두 설정 없이 실행됩니다. 기본값이 `infra/docker/compose.yaml`과 맞춰져 있습니다. 바꾸고 싶다면 `apps/api/.env.example`, `apps/web/.env.example`을 각각 `.env`로 복사하세요.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `4000` | API 포트 |
| `CLICKHOUSE_URL` | `http://127.0.0.1:8123` | ClickHouse HTTP 엔드포인트 |
| `SQLITE_PATH` | `./data/minidog.sqlite` | 메타데이터 DB |
| `WORKER_ENABLED` | `true` | API 프로세스에서 synthetic 체크 실행 |
| `ALERTS_ENABLED` | `true` | API 프로세스에서 모니터 평가 |
| `ALERT_INTERVAL_SECONDS` | `30` | 모니터 평가 주기 |
| `INGEST_REQUIRE_API_KEY` | `false` | API Key 없는 데이터 거부 |
| `API_URL` (web) | `http://127.0.0.1:4000` | 대시보드가 사용하는 Query API |

## 개발

```bash
pnpm typecheck   # 전체 패키지 타입 체크
pnpm test        # API 단위 테스트
pnpm infra:logs  # ClickHouse / Collector 로그 보기
pnpm infra:down
```

제품·디자인 기획서는 [`docs/phase-01.md`](docs/phase-01.md)에 있습니다.

## 로드맵

이미 있는 것: 로그인, Synthetics(리다이렉트·본문 문구·SSL), 호스트 지표, APM(서비스·엔드포인트·트레이스·에러·느린 쿼리·서비스 맵), 로그와 실시간 보기, Slack·Discord·Telegram·ntfy 알림, 하루 요약, 대시보드, 측정 공백 표시, ⌘K 검색.

다음:

- [ ] 공개 Docker 이미지로 한 줄 설치
- [ ] 메모리를 적게 쓰는 ClickHouse 설정과 실측값
- [ ] Heartbeat / cron 모니터
- [ ] 기준 비교 ("P95 ↑ 312% vs 지난주")

## 자원 사용량

Apple silicon Mac, Docker Desktop, ClickHouse 26.3에서 `infra/clickhouse/`의 설정(`low-memory.xml`)으로 잰 값입니다.

| | 1분 뒤 메모리 | 이미지(압축, 내려받는 크기) |
|---|---|---|
| 대시보드 (`web`) | 42 MB | 68 MB |
| API (`api`) | 45 MB | 57 MB |
| ClickHouse | 300 MB (상한 1 GiB) | 234 MB |
| OpenTelemetry Collector | 51 MB | — |

합계는 약 440 MB입니다. 대부분은 ClickHouse가 차지하고, 데이터와 쿼리가 늘면 1 GiB 상한까지 커질 수 있습니다. 새 인스턴스에 300만 행을 넣고 집계 쿼리를 돌렸을 때는 약 130 MB였고, 기본 설정에서는 260 MB였습니다. 아주 작은 에이전트는 아니므로, 업타임 체크만 필요하다면 단일 바이너리 도구가 더 가볍습니다.

## 보안

- **로그인:** 처음 접속하면 비밀번호를 정합니다. 그다음부터는 모든 화면과 Query API에 로그인이 필요합니다. 세션은 30일간 유지되고, 해시로만 저장됩니다. 15분 안에 비밀번호를 10번 틀리면 모든 사람의 로그인이 최대 15분 멈춥니다. 이미 로그인한 브라우저는 계속 쓸 수 있고, minidog을 다시 시작하면 풀립니다.
- **데이터 수신:** OTLP 수신은 별도입니다. Settings → API keys에서 키를 만들고, 이 컴퓨터 밖에서 데이터를 보낸다면 `INGEST_REQUIRE_API_KEY=true`를 켜세요.
- **네트워크:** 기본적으로 모든 서비스가 127.0.0.1에서만 열립니다. Synthetics 체크와 웹훅은 링크 로컬·클라우드 메타데이터 주소(169.254.169.254 등)에는 절대 연결하지 않습니다. 여러 사람이 쓰는 서버라면 `BLOCK_PRIVATE_TARGETS=true`로 사설망·로컬 주소도 막으세요. 웹훅은 리다이렉트를 따라가지 않으니 최종 URL을 넣으세요.
- **비밀번호를 잊었다면:** `pnpm auth:reset`를 실행하세요. 항상 켜두기 모드에서는 `docker compose -f infra/docker/compose.yaml exec api node cli/reset-password.mjs`를 실행하세요. 다음 접속 때 새로 정합니다.
- **로그인 끄기:** `AUTH_DISABLED=true`로 끌 수 있지만, 아무도 접근할 수 없는 컴퓨터에서만 쓰세요.
- **취약점 제보:** GitHub의 비공개 보안 권고(Security advisory)로 알려주세요.

## 라이선스

[MIT](LICENSE). minidog은 Datadog과 관련 없는 독립 프로젝트입니다.
