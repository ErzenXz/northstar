# Self-hosting

The provided Compose deployment is a single-node alpha intended for evaluation
and trusted teams.

## Required production changes

1. Set independent, random `SESSION_SECRET` and `NORTHSTAR_ENCRYPTION_KEY` values.
2. Put the web and Git HTTP services behind TLS and pin the SSH host key.
3. Replace default PostgreSQL credentials and enable encrypted backups.
4. Back up both PostgreSQL and the repository volume as one recovery unit.
5. Restrict worker egress to approved AI providers, import sources, and intended webhook targets.
6. Configure request size, rate, and concurrency limits at the edge; Northstar's built-in sign-in limiter is per-process and should sit behind an edge limiter in multi-node deployments.
7. Run the worker with `--network none`-style egress rules where possible: agent sandboxes deny network access by policy, and the enforcement mechanism (Linux network namespace, macOS seatbelt, or restricted-env fallback) is recorded as evidence on every run.
8. Point `NORTHSTAR_SANDBOX_ROOT` and `NORTHSTAR_BACKUP_ROOT` at storage with room for disposable workspaces and region-scoped repository bundles.

The Git HTTP and SSH services are stateless apart from their database,
repository-volume, and persisted SSH host-key dependencies. The worker claims
jobs with `FOR UPDATE SKIP LOCKED`, so multiple workers may run safely when
repository and asset storage are shared. Back up the `northstar-ssh` volume: an
unexpected host-key rotation will trigger warnings for every SSH client.

## Health checks

- Web: `GET /api/health`
- Git: `GET /health`
- SSH: TCP port `2222` (or your configured `NORTHSTAR_SSH_PORT`)
- PostgreSQL: `pg_isready`

Alpha 3 ships isolated execution sandboxes, region-scoped bundle backups with
automated restore tests, OIDC SSO, SCIM provisioning, and owner audit export.
Object-storage backup targets, SAML, and cross-region fan-out remain roadmap
work. The runner protocol coordinates external work; operators remain
responsible for sandboxing runner processes and protecting runner credentials.
