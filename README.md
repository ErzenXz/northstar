# Northstar

**The open software forge for humans and agents.**

Northstar owns the repository, not just an integration. It combines Git hosting,
organizations, issues, change records, project memory, and evidence-oriented AI
workflows in one self-hostable product. The community edition and Northstar Cloud
run the same open core.

> Status: Alpha 3. Northstar owns the repository, the merge decision, and now
> verified agent work: approved objectives execute in disposable sandboxes,
> publish evidence, pass an independent review agent, and still end at a human
> merge — with rollback and an incident trail behind them. Workspace billing
> meters and enforces model budgets locally; payment-provider invoicing and
> screenshot/preview evidence are the next roadmap items and are not
> represented as complete.

## What works today

- Local accounts, sessions, personal workspaces, and private/public repositories
- Bare Git storage with clone, fetch, and authenticated push over smart HTTP or SSH
- Personal access tokens stored as one-way hashes
- Signed SSH user keys plus repository-scoped read/write deploy keys
- Native branches, source diffs, file comments, commit-bound approvals, checks, and merge operations
- Issue comments, workspace assignees, and repository labels
- Milestones with due dates, burn-down progress, and issue filtering
- One-step GitHub migration for history, branches, tags, issues, comments, reviews, releases, assets, and wikis
- Encrypted temporary GitHub credentials in the background job queue
- HMAC-signed webhooks with redirect and private-network protections
- Commit-status API and label-aware, atomic self-hosted runner job protocol
- Source tree, text file, commit, and README browsing
- Repository pulse combining human, system, and agent activity
- Source-grounded project memory with a no-key deterministic fallback
- AI objective planning through the provider-neutral Vercel AI SDK
- Human-approved agent execution in disposable, network-controlled sandboxes
- Patch, test, and sandbox-profile evidence artifacts on every agent run
- An independent review agent, per-repository policy gates, and blocked-path rules
- One-click rollback of merged agent changes with a persistent incident trail
- Region-scoped repository backups with checksums and automated restore tests
- Workspace billing plans with metered, enforced monthly model-token budgets
- OIDC single sign-on, SCIM user provisioning, and owner-exportable audit trails
- Abuse controls: sign-in rate limits, repository count and size quotas
- An instance operations console for queue health, backups, incidents, and runners
- Docker Compose self-hosting with PostgreSQL and shared repository storage
- A clean edition seam for managed cloud capabilities

## Quick start

```bash
git clone https://github.com/ErzenXz/northstar.git
cd northstar
docker compose up --build
```

Open `http://localhost:3000`, create an account, and either create a repository
or import one from GitHub. For an immediate product tour, seed a local account:

```bash
docker compose --profile demo run --rm seed
```

The default local seed signs in with `demo@northstar.local` and
`northstar-demo-2026`. Never use the demo credentials on a public installation.

To enable AI analysis, set `AI_GATEWAY_API_KEY`. Northstar remains usable without
it and clearly labels deterministic fallback results.

## Development

```bash
docker compose up -d postgres
cp apps/web/.env.example apps/web/.env
cp apps/git/.env.example apps/git/.env
cp apps/ssh/.env.example apps/ssh/.env
cp apps/worker/.env.example apps/worker/.env
cp packages/db/.env.example packages/db/.env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Run the quality gates with:

```bash
pnpm check
pnpm lint
pnpm test
pnpm build
```

## Architecture

| Area | Package | Responsibility |
| --- | --- | --- |
| Product | `apps/web` | Next.js interface, auth, repository and project workflows |
| Git edge | `apps/git` | Smart HTTP transport and repository authorization |
| SSH edge | `apps/ssh` | Signed-key Git transport and deploy-key authorization |
| Work queue | `apps/worker` | GitHub imports, repository analysis, agent planning |
| Data | `packages/db` | PostgreSQL schema, migrations, and seed |
| Git domain | `packages/git` | Safe bare-repository operations and source inspection |
| Intelligence | `packages/ai` | Provider-neutral, typed AI workflows |
| Shared core | `packages/core` | Identity, editions, validation, and secret sealing |

Read [Architecture](docs/architecture.md), [Self-hosting](docs/self-hosting.md),
[Runner and webhook protocols](docs/protocols.md), [Cloud boundary](docs/cloud-boundary.md),
and [Roadmap](docs/roadmap.md) before working on production deployment or agent execution.

## License

Northstar is open source under AGPL-3.0-or-later. Network deployments that modify
Northstar must make those modifications available under the same license. A future
commercial agreement may cover customers who cannot use AGPL; it must never
remove capabilities from the community edition described in the governance
policy.
