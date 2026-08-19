# Contributing

Northstar is an AGPL-3.0 open-source project. Start with an issue that states the
user problem and acceptance criteria. Pull requests should include focused
tests and evidence of the user-visible behavior they change.

## Local workflow

1. Install Node 22+, pnpm 11+, Git, and Docker.
2. Run `docker compose up -d postgres`.
3. Copy each app's `.env.example` to `.env`.
4. Run `pnpm install`, `pnpm db:migrate`, and `pnpm db:seed`.
5. Run `pnpm dev`.

Use `pnpm check`, `pnpm lint`, and `pnpm test` before opening a pull request.
