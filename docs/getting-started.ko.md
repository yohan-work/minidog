# 실행 가이드

[English](getting-started.md)

minidog을 실행하는 방법, 데이터를 보내는 방법, 휴대폰으로 알림을 받는 방법, 데모 가게로 따라 해 보는 기능 둘러보기를 다룬다.

## 실행 방법

| | 이럴 때 | 명령 |
|---|---|---|
| **공개 이미지** | minidog을 쓰기만 할 때 | [`deploy/compose.yaml`](../deploy/compose.yaml)로 `docker compose up -d` |
| **소스로 실행** | minidog을 고칠 때 | `pnpm infra:up && pnpm dev` |
| **항상 켜두기(소스)** | 직접 빌드한 것을 터미널 없이 계속 돌릴 때 | `pnpm local:up` |

### 공개 이미지

```bash
mkdir minidog && cd minidog
curl -fsSLO https://raw.githubusercontent.com/yohan-work/minidog/main/deploy/compose.yaml
docker compose up -d                    # 샘플 트래픽까지 보려면 --profile demo 추가
```

- 업데이트: `docker compose pull && docker compose up -d`. 특정 릴리스로 고정하려면 `MINIDOG_VERSION=0.1.0 docker compose up -d`.
- 데이터는 `clickhouse-data`, `minidog-data` 볼륨에 있다. `docker compose down`은 데이터를 남기고, `docker compose down -v`는 지운다.
- 비밀번호를 잊었다면 `docker compose exec api node cli/reset-password.mjs`를 실행한 뒤 대시보드를 열어 새로 정한다.

### 소스로 실행

Node.js 24 이상, pnpm 10, Docker가 필요하다.

```bash
git clone https://github.com/yohan-work/minidog.git
cd minidog
pnpm install
pnpm infra:up   # ClickHouse + OpenTelemetry Collector
pnpm dev        # API :4000, 대시보드 :3000
```

비밀번호를 잊었다면 `pnpm auth:reset`.

### 항상 켜두기

`pnpm dev` 대신 소스로 빌드한 API·대시보드를 Docker로 띄우고, Docker가 켜질 때마다 자동으로 다시 시작한다.

```bash
pnpm local:up     # 빌드 후 실행
pnpm local:logs   # API·대시보드 로그
pnpm local:down   # 중지 (다시 pnpm dev를 쓸 때)
```

- `pnpm dev`와 같은 데이터(`apps/api/data`, ClickHouse 볼륨)와 설정(`apps/api/.env`)을 쓰므로 둘 중 하나만 실행한다. API가 데이터에 잠금(`minidog.sqlite.lock`)을 걸어서 다른 쪽이 켜져 있으면 시작하지 않는다. 비정상 종료로 남은 잠금은 30초 뒤 풀린다.
- 코드를 받은 뒤에는 `pnpm local:up`을 다시 실행해 새로 빌드한다.
- 재부팅 후에도 켜지게 하려면 Docker Desktop의 *Start Docker Desktop when you sign in*을 켠다. 맥이 잠자기 중이면 체크도 멈추고, 그 시간은 *not measured*로 표시된다.

## 데이터 보내기

| 경로 | 설정 |
|---|---|
| SDK → 함께 제공되는 Collector | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` |
| SDK → API 직접 | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` |
| 내가 쓰는 Collector | `otlp_http` exporter, `endpoint: http://<api>:4000`, `encoding: json` |

- API는 OTLP/HTTP **JSON**만 받는다(gzip 가능). protobuf 요청은 415로 거절되며, 함께 제공되는 Collector가 변환해 준다.
- 서비스는 `service.name`, 호스트는 `host.name`, 환경은 `deployment.environment.name` 리소스 속성에서 읽는다. `service.version`이 바뀌면 배포 표시선으로 보인다.

### API 키

**Settings → API keys**에서 환경별 키를 만든다. 키는 만들 때 한 번만 보이고 해시만 저장된다.

- 요청 헤더 `x-minidog-api-key: <key>` 또는 `Authorization: Bearer <key>`로 보낸다.
- 함께 제공되는 Collector가 키를 붙여 보내게 하려면 `MINIDOG_API_KEY=<key> pnpm infra:up`, 공개 이미지라면 `docker compose`에 `MINIDOG_API_KEY`를 지정한다.
- 키 없이 들어온 데이터는 기본 프로젝트(첫 프로젝트의 첫 환경)에 저장된다. `INGEST_REQUIRE_API_KEY=true`이면 401로 거절되고, 폐기했거나 모르는 키도 401이다.

### 리눅스 서버의 호스트 지표

Docker Desktop에서는 맥이 아니라 Docker VM의 지표가 보인다. 실제 리눅스 서버를 보려면 Collector 컨테이너에 `/:/hostfs:ro`를 마운트하고 `host_metrics.root_path: /hostfs`, `network_mode: host`를 설정한다. 위치는 [`infra/otel/collector.yaml`](../infra/otel/collector.yaml) 주석에 있다.

## 휴대폰으로 알림 받기 (무료)

모니터의 **Webhook URL**에 아래 주소 중 하나를 넣고 **Send test**로 확인한다. 주소를 보고 서비스에 맞는 형식으로 보낸다.

| 서비스 | 준비 | Webhook URL |
|---|---|---|
| ntfy (가입 없음) | 휴대폰에 ntfy 앱 설치 → 추측하기 어려운 토픽 이름 구독 (토픽은 공개라 이름이 곧 비밀번호) | `https://ntfy.sh/<토픽>` |
| Discord | 채널 설정 → 연동 → 웹후크 만들기 → URL 복사 | `https://discord.com/api/webhooks/…` |
| Telegram | @BotFather로 봇 생성 → 봇에게 메시지 → `getUpdates`로 chat id 확인 | `https://api.telegram.org/bot<토큰>/sendMessage?chat_id=<id>` |
| Slack | Incoming Webhooks 앱 추가 | `https://hooks.slack.com/services/…` |

그 밖의 주소에는 JSON(`text`, `monitor`, `state`, `message` …)을 POST 한다.

**하루 요약**: **Settings → Daily summary**에서 같은 종류의 주소와 받을 시각을 정하면, 매일 모니터별 가용성·응답 시간·인증서 남은 날, 알림 상태 변화, 측정 못 한 시간을 한 번 보낸다. 그 시각에 컴퓨터가 꺼져 있었으면 minidog이 다시 켜질 때 보낸다. 월요일에는 7일 요약으로 받을 수도 있다.

## 설정

API는 환경변수를 읽는다. 소스로 실행할 때는 `apps/api/.env`(`.env.example` 복사)를, 공개 이미지는 `compose.yaml`의 값을 쓴다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` / `HOST` | `4000` / `127.0.0.1` | API 주소 |
| `SQLITE_PATH` | `./data/minidog.sqlite` | 설정·모니터·키·세션 |
| `CLICKHOUSE_URL` · `_USER` · `_PASSWORD` · `_DATABASE` | compose 값 | 텔레메트리 저장소 |
| `WORKER_ENABLED` | `true` | 합성 체크 실행 |
| `ALERTS_ENABLED` / `ALERT_INTERVAL_SECONDS` | `true` / `30` | 모니터 평가와 주기 |
| `INGEST_REQUIRE_API_KEY` | `false` | 키 없는 OTLP 요청 거절 |
| `AUTH_DISABLED` | `false` | 로그인 끄기. 아무도 접근할 수 없는 컴퓨터에서만 |
| `BLOCK_PRIVATE_TARGETS` | `false` | 체크·웹훅이 사설망·로컬 주소에도 연결하지 않게 함(여러 사람이 쓰는 서버용) |
| `HEARTBEAT_URL` | — | minidog이 켜져 있는 동안 이 주소로 신호를 보냄. 멈추면 상대 서비스가 알아챈다(아래 참고) |
| `HEARTBEAT_INTERVAL_SECONDS` | `300` | 신호를 보내는 주기 |
| `PUBLIC_API_URL` / `PUBLIC_COLLECTOR_URL` | `http://localhost:4000` / `:4318` | Settings에 보이는 연결 정보 |

대시보드는 `/api/*`를 `API_URL`(기본 `http://127.0.0.1:4000`)로 전달하며, 요청이 올 때마다 읽는다.

보관 기간 기본값은 span·로그 14일, 지표 30일, 합성 체크 결과 90일이다. **Settings → Storage**에서 신호별 디스크 사용량을 보고 보관 기간을 바꿀 수 있다(모든 프로젝트에 적용, 줄이면 오래된 기록이 바로 지워짐).

## 서버에서 운영하기

모든 포트는 `127.0.0.1`에만 열리므로, 갓 설치한 minidog은 그 컴퓨터에서만 접속된다. 노트북에서 보려고 이 접두사를 지우면 인증 없이도 데이터를 받는 OTLP 수신구까지 함께 열린다. 더 나은 방법 두 가지가 있다.

**터널로 접속하고, 아무것도 공개하지 않기.** 바인딩은 그대로 두고 필요할 때만 포트를 넘긴다.

```bash
ssh -N -L 3000:127.0.0.1:3000 you@your-server   # 그다음 http://localhost:3000
```

Tailscale, WireGuard 같은 VPN도 같은 방식이다. Docker 입장에서 대시보드는 여전히 localhost에 있다.

**꼭 공개해야 한다면 앞에 TLS를 둔다.** 리버스 프록시에서 HTTPS를 끝내고 나머지는 닫아 둔다.

```text
minidog.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

그리고 `compose.yaml`에서:

- `INGEST_REQUIRE_API_KEY: true` — 내 서비스만 텔레메트리를 보낼 수 있게 한다.
- `BLOCK_PRIVATE_TARGETS: true` — 로그인한 브라우저가 체크·웹훅을 서버 내부망으로 돌리지 못하게 한다.
- `CLICKHOUSE_PASSWORD` — 기본값이 아닌 값으로 바꾼다.
- `4317`·`4318`은 외부에서 OTLP를 보낼 때만 열고, 열 때는 키를 필수로 한다.

프록시가 `X-Forwarded-Proto: https`를 붙이면(Caddy·nginx는 기본으로 붙인다) 로그인 쿠키에 `Secure`가 적용된다.

### minidog 자신이 죽었을 때

알림은 minidog이 보낸다. 그래서 minidog이 꺼져 있으면 아무 알림도 오지 않는다(노트북 잠자기, 컨테이너 종료, 서버가 안 돌아온 경우). 침묵을 알아채는 주소를 지정하면, 켜져 있는 동안 그 주소로 신호를 보낸다.

```yaml
HEARTBEAT_URL: https://hc-ping.com/<uuid>   # healthchecks.io, Uptime Kuma push URL 등
HEARTBEAT_INTERVAL_SECONDS: 300
```

받는 쪽은 이 주기보다 조금 여유 있게(기본 5분이면 10분마다) 기대하도록 설정한다. 그러면 minidog이 조용해질 때 알려 준다.

## 백업하기

볼륨 두 개에 모든 것이 들어 있다. `minidog-data`는 작은 SQLite 파일 하나로 비밀번호, 세션, API 키, 프로젝트, 모니터, 대시보드, 알림 이력이 들어 있다. `clickhouse-data`는 텔레메트리이고 보관 기간이 지나면 저절로 지워진다. 복사해 둘 가치가 있는 것은 앞의 것이다. 잃어버리면 전부 다시 설정하고 모든 발신처의 키를 새로 발급해야 한다.

```bash
docker compose exec api node cli/backup.mjs /data/minidog-backup.sqlite   # 공개 이미지
docker cp minidog-api-1:/data/minidog-backup.sqlite .                     # 볼륨 밖으로 꺼내기
pnpm db:backup ./minidog-backup.sqlite                                    # 소스로 실행할 때
```

minidog이 켜져 있어도 안전하다. 일관된 스냅샷으로 복사하기 때문이며, 실행 중인 SQLite 파일을 그냥 `cp`로 복사하는 것은 안전하지 않다.

되돌릴 때는 API를 먼저 멈춘다. API가 데이터에 잠금을 걸고 있고, 잠금이 걸린 동안에는 복구가 거부된다.

```bash
docker compose stop api
docker compose run --rm -v "$PWD:/backup" api node cli/restore.mjs /backup/minidog-backup.sqlite
docker compose start api
```

소스로 실행할 때는 minidog을 멈추고 `pnpm db:restore ./minidog-backup.sqlite`.

`docker compose down`은 볼륨을 남기고, `docker compose down -v`는 지운다.

## 데모 가게로 둘러보기

데모를 켠다(`docker compose --profile demo up -d`, 소스라면 `pnpm demo`). `web → api → payment`와 가상의 Postgres가 트래픽을 만든다. 실행 중에 동작을 바꿀 수 있다.

```bash
curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":300}'         # DB 느리게
curl -X POST localhost:5100/__demo/scenario -d '{"paymentErrorRate":0.2}'  # 결제 실패 20%
curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":null,"slowDb":false,"paymentErrorRate":0.02}'  # 원래대로
```

공개 이미지로 실행했다면 5100 포트는 Docker 안에서만 열려 있다. `docker compose exec demo wget -qO- --post-data '{"dbDelayMs":300}' 127.0.0.1:5100/__demo/scenario`처럼 실행한다.

| 해 볼 것 | 방법 |
|---|---|
| 업타임 체크 | Synthetics → New monitor → `https://example.com`. 상세에서 상태·가용성·지연·이력 |
| 느린 엔드포인트 → span | Services → `api` → `POST /checkout` → 느린 트레이스 → waterfall의 가장 느린 span |
| 에러 → 로그 | Traces → Status: Errors → 트레이스 → Related logs. Logs 화면에서는 반대로 트레이스로 이동 |
| 지연 알림 | Monitors → New monitor → Latency, `api`, warning 250 ms, critical 500 ms. `dbDelayMs`를 200, 600으로 올리면 이력이 Healthy → Warning → Critical |
| 구간 드릴다운 | `paymentErrorRate`를 0.5로 → Services 요청 차트를 드래그 → Exceptions. Errors에 `card declined by issuer`가 묶여 보인다 |
| 느린 쿼리 | `dbDelayMs` 300 상태에서 Queries에 `INSERT INTO orders …`가 총 소요 시간 1위. 누르면 가장 느린 호출 |
| 배포 표시선 | 소스에서 `DEMO_VERSION=1.1.0 pnpm demo`로 다시 실행 → 서비스 차트에 `1.1.0` 세로선, Versions에서 1.0.0과 1.1.0 비교 |
| 실시간 로그 | Logs → **Live tail**. 새 로그가 2초마다 쌓이고 필터도 적용된다 |
| 휴대폰 알림 | 모니터 Webhook URL에 `https://ntfy.sh/<토픽>` → **Send test** |
| 측정 공백 | minidog을 몇 분 끄거나 맥을 잠자기 → 모니터 가용성 막대에 빗금 친 *not measured* 구간 |
| 검색 | 아무 화면에서 ⌘K → `checkout`. 32자리 trace id를 붙여 넣으면 그 트레이스로 |
| 대시보드 | Dashboards → New dashboard → 합성 모니터·서비스 차트·지표 추가. Metrics의 **Add to dashboard**로도 추가 |
