# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/yohan-work/minidog/security/advisories/new)). Do not open a public issue.

Include what you can:

- the version (release tag or commit) and how you run minidog (Docker Compose, from source);
- steps to reproduce, or a proof of concept;
- what an attacker can do with it.

minidog has one maintainer. You can expect an acknowledgement within a week and a fix or a plan soon after, depending on severity. You will be credited in the release notes unless you prefer otherwise.

## Supported versions

Fixes go into the latest release. minidog is pre-1.0; older releases are not patched.

## Security model

Worth knowing before you report:

- **Single user.** One password protects the dashboard and its Query API. There are no roles.
- **Localhost by default.** Every port is published on 127.0.0.1. Exposing the dashboard to the internet is not a goal; if you do, put it behind TLS and ideally a VPN or an authenticating proxy.
- **Sign-in throttling is global.** The dashboard's proxy does not pass on client addresses, so after 10 wrong passwords within 15 minutes sign-in pauses for everyone (signed-in browsers keep working). This is a deliberate trade-off, not a bug.
- **Outbound requests.** Synthetic checks and webhooks never connect to link-local or cloud metadata addresses. Private and loopback targets are allowed unless `BLOCK_PRIVATE_TARGETS=true`, because checking your own local apps is a normal use.
- **OTLP ingest** is authorised by API keys, separately from sign-in. Set `INGEST_REQUIRE_API_KEY=true` if anything outside this machine sends data.

Reports that show a way around these, such as reaching the API without a session, making a check reach a metadata address, or reading another project's data with an API key, are exactly what we want to hear about.
