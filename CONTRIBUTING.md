# Contributing to minidog

Thanks for taking the time. minidog is a small project with one maintainer, so a little context up front saves both of us time.

## What fits

minidog is self-hosted observability for **one developer's side projects**: uptime checks, traces, logs, metrics and alerts in one Docker Compose file. Changes that keep it that way are welcome:

- bug fixes, clearer errors, better empty states;
- making it lighter, faster or easier to install;
- features a solo developer would use weekly (see the roadmap in the README).

Things that would change what minidog is, such as multi-tenant SaaS, teams and roles, or a new storage engine, should start as an issue so we can talk before you write code.

## Setting up

You need Node.js 24+, pnpm 10 and Docker.

```bash
git clone https://github.com/yohan-work/minidog.git
cd minidog
pnpm install
pnpm infra:up   # ClickHouse + OpenTelemetry Collector in Docker
pnpm dev        # API on :4000, dashboard on :3000
pnpm demo       # optional: three services sending sample traffic
```

Open http://localhost:3000 and set a password. [`docs/architecture.md`](docs/architecture.md) explains how the pieces fit together and where to change what.

## Before opening a pull request

Run what CI runs:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check:deploy   # only if you touched infra/ or deploy/
```

- **One change per PR**, as small as it can be. Refactors go in their own PR.
- **Behaviour changes come with a test.** API tests use `node:test` with `app.inject`; see `apps/api/src/routes/auth.test.ts` for a full example that needs no ClickHouse.
- **UI changes include a screenshot** (light and dark, if colours changed).
- **Docs follow the code.** Update `README.md`, and `README.ko.md` when the change is user-visible (English is fine; the maintainer can translate).
- **No new runtime dependency** without saying why in the PR.
- Commit messages: a short imperative subject ("Keep checks off metadata addresses"), and a body that says *why*.

## AI-assisted contributions

minidog itself was built with AI assistance, and the same rules apply to your PRs: you should understand every line you submit, have run it, and say in the PR description that an assistant helped. Unreviewed generated code will be closed.

## Where to start

Issues labelled [`good first issue`](https://github.com/yohan-work/minidog/labels/good%20first%20issue) are small and self-contained. Comment on one before you start so nobody duplicates work.

## Security issues

Please do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
