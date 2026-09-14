# 개인용 Observability SaaS 기획서

## 1. 프로젝트 개요

### 프로젝트 정의

Datadog의 핵심 Observability 경험을 개인 개발자 및 소규모 프로젝트 환경에 맞게 단순화한 웹 기반 모니터링 SaaS를 구축한다.

Datadog 전체 기능을 복제하는 것이 목적이 아니다.

핵심은 다음 흐름이다.

**Collect → Normalize → Correlate → Explore → Detect**

사용자는 자신이 운영하는 여러 웹 서비스와 서버를 등록하고 하나의 Dashboard에서 다음 질문에 빠르게 답할 수 있어야 한다.

- 서비스가 정상적으로 살아 있는가?
- 현재 느려지고 있는 서비스가 있는가?
- 에러가 증가하고 있는가?
- 어느 API 또는 서비스에서 문제가 발생했는가?
- 해당 요청에서 어떤 로그가 발생했는가?

제품의 가장 중요한 UX 목표는 다음과 같다.

> 문제가 발생했을 때 3번 이하의 화면 이동으로 원인에 접근한다.

---

# 2. 프로젝트 목표

## Primary Goal

개인 개발자가 자신이 운영하는 여러 서비스를 하나의 Observability Dashboard에서 모니터링할 수 있게 한다.

초기에는 개인 사용을 전제로 하되 향후 소규모 팀에서도 사용할 수 있는 구조를 고려한다.

## Secondary Goal

다음 Observability 개념을 실제 제품 수준으로 구현한다.

- Infrastructure Monitoring
- Metrics
- Distributed Tracing
- Logging
- Synthetic Monitoring
- Monitoring / Alert
- Service Dependency
- Telemetry Correlation

---

# 3. 목표 사용자

초기 타깃은 기업 DevOps 조직이 아니다.

### Primary

- 개인 개발자
- 사이드 프로젝트 운영자
- Indie Hacker
- 개인 서버 운영자

### Secondary

- 2~10명 규모 스타트업
- 소규모 개발팀
- 여러 프로젝트를 관리하는 프리랜서

---

# 4. 핵심 제품 철학

Datadog의 모든 기능을 따라가지 않는다.

대신 Datadog이 잘하는 핵심 경험만 가져온다.

## 4.1 One place

서비스별 관리 페이지를 돌아다니지 않는다.

```text
Project A
Project B
API Server
Database
Personal Server

```

모두 하나의 Dashboard에서 확인한다.

## 4.2 Correlation

Metrics / Trace / Logs가 서로 분리된 제품처럼 존재해서는 안 된다.

```text
CPU 증가
 ↓
API latency 증가
 ↓
Trace 확인
 ↓
Slow Span 발견
 ↓
Related Logs

```

하나의 조사 흐름으로 연결되어야 한다.

## 4.3 Progressive Disclosure

처음부터 모든 데이터를 보여주지 않는다.

```text
System
 ↓
Service
 ↓
Endpoint
 ↓
Trace
 ↓
Span
 ↓
Log

```

필요한 만큼 깊게 탐색한다.

## 4.4 Signal over Data

많은 데이터를 보여주는 것이 목적이 아니다.

사용자가 먼저 봐야 하는 것은 데이터가 아니라 상태다.

```text
Healthy
Degraded
Critical
Unknown

```

---

# 5. MVP 범위

## V0.1

첫 번째 버전에서는 다음 기능까지만 구현한다.

### Project

- Project 생성
- Environment 설정
- API Key 생성
- Collector 연결 정보 제공

### Overview

- Service Count
- Request Count
- Error Rate
- P95 Latency
- Active Alerts
- Request Throughput
- Error Trend
- Latency Trend
- Service Health

### Infrastructure

- Host 목록
- CPU
- Memory
- Disk
- Network 기본 정보

### Services

- 서비스 목록
- 서비스 Health
- Requests/sec
- Error Rate
- P50 / P95 / P99 latency

### Traces

- Trace Explorer
- Filter
- Trace Detail
- Span Waterfall
- Slow Span 강조

### Logs

- Log Explorer
- Service Filter
- Level Filter
- Search
- Trace ID 연결

### Correlation

반드시 구현한다.

```text
Trace
→ Related Logs

Log
→ Related Trace

```

### Synthetic Monitoring

- HTTP URL 등록
- Status Code
- Latency
- Availability
- SSL expiry

### Monitor

초기에는 네 종류만 제공한다.

- Service Down
- Error Rate
- Latency
- CPU / Memory

### Alert

초기 Alert destination은 단순화한다.

- Dashboard Notification
- Webhook

---

# 6. 제외 범위

초기에는 아래 기능을 구현하지 않는다.

- Kubernetes
- AWS Integration
- Azure Integration
- GCP Integration
- Network Packet Monitoring
- Session Replay
- Mobile RUM
- SIEM
- Security Monitoring
- Incident Management
- Billing
- Organization
- Complex RBAC
- AI Chat
- Natural Language Query
- Dashboard Drag &amp; Drop Builder
- Marketplace
- 대규모 Integration

기능 확장보다 Core Monitoring Experience 완성도를 우선한다.

---

# 7. Information Architecture

Primary navigation은 다음으로 제한한다.

```text
Overview

Observe
 ├ Services
 ├ Infrastructure
 ├ Metrics
 ├ Traces
 └ Logs

Monitor
 ├ Synthetics
 └ Monitors

Settings

```

메뉴를 지나치게 세분화하지 않는다.

---

# 8. 핵심 사용자 흐름

## Flow 1 — 현재 시스템 확인

```text
Login

↓

Overview

↓

Service Health 확인

```

Overview만 보고도 전체 시스템 상태를 판단할 수 있어야 한다.

---

## Flow 2 — 느려진 API 조사

```text
Overview

Payment Service
Degraded

↓

Service Detail

P95 1.4s ↑

↓

Slow Endpoint

POST /checkout

↓

Trace

↓

Slow Span

postgres.query
580ms

↓

Related Logs

```

이것이 제품의 가장 중요한 경험이다.

---

## Flow 3 — 장애 조사

```text
Alert

API unavailable

↓

Monitor Detail

↓

Affected Service

↓

Related Metrics

↓

Traces / Logs

```

---

# 9. 시스템 아키텍처

전체 구조는 다음을 기준으로 한다.

```text
Application
     │
     │ OTLP
     ▼
OpenTelemetry Collector
     │
     ▼
Ingestion API
     │
     ▼
ClickHouse
     │
     ▼
Query API
     │
     ▼
Web Dashboard

```

Telemetry 표준은 OpenTelemetry를 사용한다.

Vendor-specific SDK를 직접 제작하지 않는다.

---

# 10. 기술 스택

## Frontend

```text
Next.js
TypeScript
React
SCSS / CSS Modules
CSS Variables
Geist Sans
Geist Mono
ECharts 또는 uPlot
React Flow

```

Tailwind를 필수로 사용하지 않는다.

디자인 시스템은 CSS Variables 기반 Design Token으로 구성하고 SCSS/CSS Module에서 사용한다.

## Backend

```text
Node.js
TypeScript
Fastify

```

## Telemetry

```text
OpenTelemetry SDK
OpenTelemetry Collector
OTLP

```

## Storage

### Telemetry

```text
ClickHouse

```

저장 대상:

- Metrics
- Spans
- Logs
- Synthetic Results

### Application Metadata

초기:

```text
SQLite

```

향후 SaaS화:

```text
PostgreSQL

```

---

# 11. 데이터 모델

## Span

```text
trace_id
span_id
parent_span_id

timestamp
duration

service_name
span_name

status

http_method
http_route
http_status

attributes

```

## Log

```text
timestamp

service_name
environment

level
message

trace_id
span_id

attributes

```

## Metric

```text
timestamp

metric_name
value

service
host
environment

labels

```

## Synthetic Result

```text
timestamp

monitor_id

status
status_code

latency
dns_time
tls_time
ttfb

ssl_expiry

```

---

# 12. Correlation 설계

이 제품의 핵심이다.

각 데이터에는 가능한 경우 반드시 다음 Context를 포함한다.

```text
project
environment
service
host

trace_id
span_id

```

이를 기반으로 서로 이동할 수 있게 한다.

```text
Service
 ↕
Metrics
 ↕
Trace
 ↕
Logs

```

Telemetry 메뉴가 서로 독립된 페이지처럼 느껴지지 않게 한다.

---

# 13. Design Direction

## Reference

주요 디자인 레퍼런스는 Vercel의 제품 UI와 Geist Design System으로 한다.

Vercel 디자인을 그대로 복제하지 않는다.

Vercel의 브랜드 표현보다 다음 원칙을 가져온다.

- Simplicity
- Precision
- Strong alignment
- Functional hierarchy
- Minimal decoration
- High information density
- Fast interaction
- Consistent state design

Vercel은 Geist를 일관된 웹 경험을 위한 Design System으로 정의하고 있으며, Grid를 현재 Vercel aesthetic의 중요한 요소 중 하나로 명시하고 있다.

---

# 14. Visual Principle

전체 인터페이스는 다음 방향으로 구성한다.

```text
Minimal
Technical
Dense
Precise
Neutral
Functional

```

피해야 할 표현:

```text
AI SaaS 스타일
과도한 gradient
Glassmorphism
큰 radius 카드
과도한 shadow
불필요한 illustration
과도한 icon 사용
Hero-style dashboard
장식용 animation

```

Observability 도구답게 **데이터 자체가 화면의 주인공**이 되어야 한다.

---

# 15. Layout System

Vercel 스타일에서 가장 중요한 요소 중 하나를 Grid로 본다.

Dashboard 전체를 Grid 기반으로 설계한다.

Desktop 기준:

```text
┌───────┬───────────────────────────────────┐
│       │ Top Context Bar                   │
│       ├───────────────────────────────────┤
│ Side  │                                   │
│ Nav   │ Content                           │
│       │                                   │
│       │                                   │
└───────┴───────────────────────────────────┘

```

### Navigation

Sidebar width:

```text
220~240px

```

Sidebar 자체를 강하게 강조하지 않는다.

Border를 통해 Content와 구분한다.

### Content

Maximum width를 지나치게 제한하지 않는다.

Observability Dashboard 특성상 wide viewport를 적극적으로 활용한다.

기본:

```text
padding: 24px

```

Dense 화면:

```text
padding: 16px

```

### Grid

기본 spacing 단위:

```text
4
8
12
16
24
32
48
64

```

임의 spacing 값을 만들지 않는다.

---

# 16. Surface Design

Dashboard를 카드들의 집합처럼 만들지 않는다.

가능한 경우 border 기반 Section 구조를 사용한다.

Bad:

```text
[ Rounded Card ]

[ Rounded Card ]

[ Rounded Card ]

```

Preferred:

```text
────────────────────────────

Section

────────────────────────────
│          │
│ Metric   │ Metric
│          │
────────────────────────────

```

Panel 간 hierarchy는 다음으로 표현한다.

1. Border
2. Background variation
3. Typography
4. Spacing

Shadow는 최후 수단으로 사용한다.

---

# 17. Border

Vercel Geist Color System처럼 Border를 Component state의 일부로 사용한다.

대략적인 semantic token:

```text
--border-default
--border-hover
--border-active
--border-strong

```

UI 상태:

```text
Default
Hover
Active
Focus
Disabled

```

각 상태의 대비가 점진적으로 증가해야 한다.

---

# 18. Color System

색을 장식용으로 사용하지 않는다.

## Neutral

대부분의 UI:

```text
Background
Surface
Border
Primary Text
Secondary Text
Muted Text

```

## Semantic

상태 표현에만 색을 사용한다.

```text
Green
Healthy / Success

Amber
Warning / Degraded

Red
Error / Critical

Blue
Informational / Active

```

그래프에서도 지나치게 많은 색상을 사용하지 않는다.

같은 의미는 모든 화면에서 동일한 색을 사용한다.

그리고 색깔만으로 상태를 전달하지 않는다.

```text
● Healthy
▲ Warning
● Critical

```

처럼 Text / Icon을 함께 제공한다.

Vercel Web Interface Guidelines 역시 status를 색상에만 의존하지 않고 중복된 cue를 제공할 것을 권장한다.

---

# 19. Theme

초기부터 다음 두 Theme을 지원할 수 있는 Token 구조로 설계한다.

```text
Light
Dark

```

다만 MVP 개발에서는 Dark Mode부터 완성해도 된다.

Observability 제품 특성상 Dark Mode를 주요 화면으로 사용할 수 있다.

Token 이름에는 색상값을 직접 표현하지 않는다.

Bad:

```text
--gray-200
--white

```

Preferred:

```text
--background-primary
--background-secondary

--foreground-primary
--foreground-secondary

--border-primary

--status-success
--status-warning
--status-error

```

---

# 20. Typography

Font:

```text
Geist Sans
Geist Mono

```

Vercel의 Geist는 개발자와 디자이너를 위한 Typeface로 설계되었으며 명확성, 정밀성, 기능성을 핵심으로 한다.

Geist Sans:

```text
Navigation
Heading
Description
Button
Form
Table label

```

Geist Mono:

```text
Metric Value
Timestamp
Trace ID
Span ID
Duration
HTTP Status
Code
Log
Endpoint

```

Observability 제품이므로 Mono Typeface를 적극적으로 활용한다.

---

# 21. Typography Hierarchy

불필요하게 큰 Heading을 사용하지 않는다.

Dashboard 기준:

```text
Page Title
20~24px

Section Title
14~16px

Default UI
14px

Secondary
13px

Meta
12px

```

숫자 데이터는 tabular number를 사용한다.

예:

```text
1,248 req/s
0.342 %
248 ms
99.982 %

```

숫자의 폭이 변하지 않아 그래프와 테이블의 안정성을 유지해야 한다.

Vercel 역시 숫자 비교 UI에서는 tabular numbers 또는 Geist Mono 사용을 권장한다.

---

# 22. Dashboard Header

Page Header는 가능한 단순하게 구성한다.

예:

```text
Overview

Production                  Last 1 hour ▾

```

다음과 같은 큰 Hero 영역을 사용하지 않는다.

```text
Welcome back!
Monitor your amazing applications.

```

제품 Dashboard에서는 즉시 데이터에 접근한다.

---

# 23. Overview 디자인

```text
Overview                       Production · Last 1h

────────────────────────────────────────────────────

Services        Requests       Error Rate       P95
6               18.4k          0.32%            248ms

────────────────────────────────────────────────────

Request Throughput

 ────────╮
         ╰────────╮
                  ╰─────────

────────────────────────────────────────────────────

Service                        Requests    Error   P95

● web                          8.2k        0.02%   42ms
● api                          7.4k        0.12%   132ms
▲ payment                      1.2k        5.82%   1.42s
● postgres                     4.8k        0.01%   18ms

────────────────────────────────────────────────────

```

카드 UI보다 **Table + Divider + Chart** 중심으로 구성한다.

---

# 24. Service Detail

```text
← Services

payment

Degraded

────────────────────────────────────────

Requests       Error Rate       P95
1.2k           5.82%            1.42s

────────────────────────────────────────

Latency

────────────────────────────────────────

Endpoints

POST /checkout      812ms
POST /payment       242ms
GET /payment/:id     92ms

────────────────────────────────────────

Recent Traces

```

문제 항목은 강한 색상의 Card가 아니라 상대적인 Contrast로 강조한다.

---

# 25. Trace Explorer

Observability UI에서 가장 중요한 화면 중 하나다.

```text
Traces

Service ▾    Status ▾    Duration ▾      Search...

──────────────────────────────────────────────────────

TIME        SERVICE       NAME             DURATION

14:32:08    api           POST /checkout   757 ms
14:32:07    api           GET /products     83 ms
14:32:05    payment       POST /payment    612 ms

```

Dense Table을 사용한다.

Row hover 시 background contrast만 살짝 높인다.

---

# 26. Trace Detail

Waterfall을 중심으로 구성한다.

```text
POST /checkout

757 ms        ERROR

──────────────────────────────────────────────

api.request
██████████████████████████████████████

 auth
 ██

 order
 ████

 postgres.query
             █████████████████████████

 payment
                                  █████

──────────────────────────────────────────────

Attributes

http.method       POST
http.status       500
service           api

──────────────────────────────────────────────

Related Logs 12 →

```

Slow Span은 즉시 인식할 수 있어야 한다.

---

# 27. Logs

```text
Logs

api ▾      error ▾      Search logs...

────────────────────────────────────────────────────

14:32:08.124

ERROR

payment request failed

service=api
trace=8c1fa27
route=/checkout

```

로그 UI는 개발자가 실제 로그를 읽는 경험에 가깝게 구성한다.

Log message:

```text
Geist Mono

```

사용.

---

# 28. Charts

차트를 제품의 장식 요소로 사용하지 않는다.

차트는 질문에 답해야 한다.

예:

```text
Is traffic increasing?

Is latency degrading?

When did errors begin?

```

Chart 기본 규칙:

- Grid line 최소화
- Axis label 최소화
- Tooltip 명확하게
- 동일 Metric 색상 일관성 유지
- Hover crosshair 제공
- Time range 공유
- Empty state 지원
- Loading state 지원

Charts 역시 accessibility를 고려하여 color-blind-safe palette를 사용한다. Vercel Web Interface Guidelines도 접근 가능한 Chart palette를 명시한다.

---

# 29. Components

다음 공통 컴포넌트를 우선 구축한다.

## Foundation

```text
Typography
Icon
Divider
Stack
Grid
Surface

```

## Inputs

```text
Button
IconButton
Input
SearchInput
Select
Combobox
Checkbox
Switch

```

## Data

```text
Metric
Badge
Status
Table
DataTable
Code
CodeBlock
Timestamp

```

## Observability

```text
MetricChart
TimeSeriesChart
StatusIndicator
ServiceRow
TraceRow
TraceWaterfall
SpanRow
LogRow
MonitorRow

```

## Overlay

```text
Tooltip
Popover
Dropdown
Dialog
CommandMenu

```

---

# 30. Component State

모든 컴포넌트는 최소 다음 상태를 정의한다.

```text
Default
Hover
Focus
Active
Disabled
Loading
Error

```

데이터 화면은 추가로:

```text
Empty
Sparse
Normal
Dense
Error
Stale

```

상태를 포함한다.

Vercel Web Interface Guidelines 역시 empty, sparse, dense, error를 포함한 모든 상태를 설계할 것을 강조한다.

---

# 31. Interaction

Motion은 존재감을 드러내기 위해 사용하는 것이 아니다.

사용자의 위치와 변화를 이해시키기 위해서만 사용한다.

사용:

```text
opacity
transform

```

중심.

피한다:

```text
transition: all
대규모 scale
과도한 spring
scroll animation
decorative animation

```

Vercel 역시 `transition: all` 대신 실제 변경할 property를 명시할 것을 권장한다.

기본 duration:

```text
100~200ms

```

정도로 제한한다.

---

# 32. Loading

Layout Shift가 발생하지 않게 한다.

Skeleton은 실제 콘텐츠 구조와 동일한 크기를 사용한다.

잘못된 형태:

```text
generic gray rectangle

```

올바른 형태:

```text
Table skeleton
Metric skeleton
Chart skeleton

```

---

# 33. Empty State

화면을 막지 않는다.

Bad:

```text
No Data

```

Preferred:

```text
No traces yet

Send your first trace using OpenTelemetry.

View setup →

```

모든 Empty State에는 사용자가 할 수 있는 다음 행동이 있어야 한다.

---

# 34. Error State

단순히:

```text
Something went wrong

```

으로 끝내지 않는다.

가능하면 원인과 Recovery Action을 제공한다.

```text
Unable to query traces

ClickHouse did not respond.

Retry

```

---

# 35. Responsive

Main target:

```text
Desktop
Laptop

```

Observability Dashboard 특성상 Mobile은 조회 중심으로 제한해도 된다.

Breakpoints:

```text
≥ 1440
Wide

1024 ~ 1439
Desktop

768 ~ 1023
Tablet

< 768
Mobile

```

Desktop에서 Dashboard를 지나치게 가운데 좁게 묶지 않는다.

Ultra-wide에서도 information density가 유지되어야 한다.

---

# 36. Accessibility

반드시 고려한다.

- Keyboard Navigation
- Visible Focus
- Semantic HTML
- ARIA Label
- Contrast
- Status text
- Accessible chart
- Reduced Motion
- Screen Reader Label

Icon-only action에는 반드시 accessible name을 넣는다.

---

# 37. Design Token 구조

초기부터 token 파일을 별도로 관리한다.

```text
styles/
 ├ tokens/
 │   ├ color.scss
 │   ├ typography.scss
 │   ├ spacing.scss
 │   ├ radius.scss
 │   ├ shadow.scss
 │   └ motion.scss
 │
 ├ globals.scss
 └ reset.scss

```

예:

```css
:root {
  --background-primary: ...;
  --background-secondary: ...;

  --foreground-primary: ...;
  --foreground-secondary: ...;

  --border-primary: ...;
  --border-secondary: ...;

  --status-success: ...;
  --status-warning: ...;
  --status-error: ...;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
}

```

컴포넌트 내부에 임의 색상값과 spacing 값을 작성하지 않는다.

---

# 38. Radius

Vercel 스타일을 참고하여 radius를 상당히 절제한다.

기본:

```text
4px
6px
8px

```

정도만 사용한다.

대형:

```text
16px
24px

```

radius를 Dashboard card 기본값으로 사용하지 않는다.

Nested component에서는 parent와 child radius가 시각적으로 일관되도록 구성한다.

---

# 39. Icons

Icons는 모두 하나의 Icon System을 사용한다.

라인 아이콘을 우선한다.

Icon 자체가 의미를 전달한다고 가정하지 않는다.

예:

```text
⚠ Degraded

```

Icon + Label을 기본으로 한다.

장식 목적의 아이콘 사용은 피한다.

---

# 40. Product Copy

Observability 도구이므로 Copy는 짧고 기술적으로 명확해야 한다.

Bad:

```text
Oops! Something went wrong.
Let's get you back on track!

```

Preferred:

```text
Unable to load traces.

Retry

```

또는:

```text
Collector disconnected

Last seen 4m ago

```

---

# 41. 프로젝트 폴더 구조

예시:

```text
apps/

  web/
    app/
    components/
    features/
    lib/
    styles/

  api/
    routes/
    services/
    repositories/

packages/

  ui/

  telemetry/

  types/

  config/

infra/

  clickhouse/

  otel/

  docker/

docs/

```

UI 컴포넌트와 Observability domain component를 분리한다.

```text
components/ui

components/observability

```

또는 packages 단위로 분리한다.

---

# 42. 개발 단계

## Phase 0 — Foundation

구현:

```text
Monorepo
Next.js
Fastify
ClickHouse
SQLite
Docker Compose
OTel Collector

```

그리고 Design Foundation:

```text
Tokens
Typography
Layout
Button
Input
Select
Badge
Table
Tooltip

```

---

## Phase 1 — Synthetic Monitoring

가장 먼저 end-to-end Data Flow를 완성한다.

```text
URL 등록

↓

Worker

↓

HTTP Request

↓

ClickHouse

↓

Query API

↓

Dashboard Chart

```

구현:

- Monitor 생성
- HTTP Check
- Status
- Response Time
- Availability
- History Chart

---

## Phase 2 — Infrastructure

OpenTelemetry Collector를 통해:

```text
CPU
Memory
Disk

```

수집.

---

## Phase 3 — Metrics

Metrics Explorer 구현.

```text
Metric
Aggregation
Time Range
Service Filter

```

---

## Phase 4 — APM

OpenTelemetry Trace 수집.

구현:

```text
Services
Endpoints
Traces
Span
Waterfall

```

---

## Phase 5 — Logs

구현:

```text
Log ingestion
Search
Filter
Structured attributes

```

---

## Phase 6 — Correlation

가장 중요한 단계.

```text
Trace → Logs

Logs → Trace

Service → Traces

Service → Metrics

```

---

## Phase 7 — Monitors

구현:

```text
Threshold Engine
Monitor State
Monitor History
Webhook

```

---

## Phase 8 — Service Map

OpenTelemetry Span 관계를 분석해:

```text
Web
 ↓
API
 ↓
Payment
 ↓
PostgreSQL

```

서비스 Dependency를 생성한다.

React Flow를 사용할 수 있다.

---

# 43. Claude Code 작업 원칙

Claude Code는 구현 중 임의로 Product Scope를 확장하지 않는다.

다음 우선순위를 따른다.

```text
Correctness

↓

Data Flow

↓

Usability

↓

Visual Quality

↓

Additional Features

```

기능을 추가하기 전에 기존 기능의 완성도를 우선한다.

---

# 44. Claude Code Design Rule

Claude Code에게 단순히:

```text
Make it look like Vercel.

```

이라고 지시하지 않는다.

다음 Design Context를 항상 기준으로 한다.

```text
Vercel-inspired, not Vercel copied.

Dense developer-tool interface.

Neutral surfaces.

Grid-first layout.

Border-driven hierarchy.

Minimal radius.

Minimal shadow.

Geist typography.

Monospace for technical values.

No decorative gradients.

No glassmorphism.

No oversized SaaS cards.

No unnecessary icons.

No marketing-style dashboard.

Data is the primary visual element.

```

---

# 45. AI Generated UI 방지 규칙

다음 패턴이 발견되면 수정한다.

```text
큰 gradient background

rounded-2xl 카드 반복

모든 영역 Card wrapping

dashboard icon 남발

purple / blue gradient

큰 Welcome message

불필요한 subtitle

과도한 whitespace

emoji

floating elements

marketing copy

glass background

```

우리가 만드는 것은 AI SaaS Landing Page가 아니라 Developer Infrastructure Product다.

---

# 46. UI Quality Checklist

모든 화면 구현 후 다음을 확인한다.

### Layout

- 모든 요소가 Grid 또는 Alignment 기준을 갖는가?
- 임의 위치 값이 존재하지 않는가?
- Ultra-wide에서도 자연스러운가?

### Typography

- hierarchy가 명확한가?
- 숫자는 tabular인가?
- technical data에 Mono가 적절히 사용됐는가?

### States

- Loading
- Empty
- Error
- Dense
- Hover
- Focus
- Disabled

상태가 모두 구현되었는가?

### Interaction

- motion이 기능적인가?
- transition: all이 없는가?
- layout shift가 없는가?

### Accessibility

- Keyboard 접근 가능한가?
- Focus가 보이는가?
- 색상 없이도 상태를 알 수 있는가?

---

# 47. MVP 완료 기준

다음 Scenario가 실제로 동작하면 V0.1을 완료로 판단한다.

### Scenario A

사용자가 URL Monitor를 등록한다.

```text
https://example.com

```

Dashboard에서:

```text
Status
Uptime
Latency
History

```

를 확인할 수 있다.

### Scenario B

Node.js Application에서 OpenTelemetry를 전송한다.

Dashboard에서:

```text
Service

↓

Endpoint

↓

Trace

↓

Span

```

을 볼 수 있다.

### Scenario C

에러 Trace를 클릭한다.

```text
Trace

↓

Related Logs

```

에서 해당 요청의 Log를 볼 수 있다.

### Scenario D

Latency Monitor 조건을 초과한다.

```text
Healthy

↓

Warning

↓

Critical

```

상태 변경 이력이 저장된다.

---

# 48. 최종 제품 경험

최종적으로 사용자가 제품을 열었을 때 다음처럼 보여야 한다.

```text
Production                        Last 1 hour

───────────────────────────────────────────────

6 Services     18.4k Requests     0.32% Errors

───────────────────────────────────────────────

▲ 1 service needs attention

payment

P95 latency
1.42s ↑ 312%

Error rate
5.82%

Likely affected endpoint

POST /checkout

View traces →

───────────────────────────────────────────────

Services

● web
● api
▲ payment
● postgres
● worker

───────────────────────────────────────────────

```

사용자는 여기서 바로:

```text
payment

↓

POST /checkout

↓

Trace

↓

postgres.query

↓

Related Logs

```

로 내려갈 수 있다.

이 흐름이 자연스럽게 완성되는 것이 이 프로젝트의 가장 중요한 성공 기준이다.

---

# 49. 핵심 한 문장

이 프로젝트는

**“Datadog을 작게 복제하는 서비스”**

가 아니다.

목표는:

> **여러 개인 서비스를 한곳에서 관찰하고, 문제가 발생했을 때 Metrics → Trace → Logs를 연결해 빠르게 원인을 찾아주는 개인 개발자용 Observability Platform**

을 만드는 것이다.

디자인 또한 단순히 Vercel UI를 복제하는 것이 아니라:

> **Vercel/Geist의 정밀하고 체계적인 Developer Tool 디자인 원칙을 Observability 환경에 맞게 재해석한다.**

이를 프로젝트 전체의 Product / Design / Engineering 기준으로 사용한다.