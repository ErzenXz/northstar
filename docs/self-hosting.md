# Self-hosting

The provided Compose deployment is a single-node alpha intended for evaluation
and trusted teams.

## Required production changes

1. Set independent, random `SESSION_SECRET` and `ORIGIN_ENCRYPTION_KEY` values.
2. Put the web and Git HTTP services behind TLS and pin the SSH host key.
3. Replace default PostgreSQL credentials and enable encrypted backups.
4. Back up both PostgreSQL and the repository volume as one recovery unit.
5. Restrict worker egress to approved AI providers, import sources, and intended webhook targets.
6. Configure request size, rate, and concurrency limits at the edge.
7. Do not expose future agent execution without isolated, disposable sandboxes.

The Git HTTP and SSH services are stateless apart from their database,
repository-volume, and persisted SSH host-key dependencies. The worker claims
jobs with `FOR UPDATE SKIP LOCKED`, so multiple workers may run safely when
repository and asset storage are shared. Back up the `origin-ssh` volume: an
unexpected host-key rotation will trigger warnings for every SSH client.

## Health checks

- Web: `GET /api/health`
- Git: `GET /health`
- SSH: TCP port `2222` (or your configured `ORIGIN_SSH_PORT`)
- PostgreSQL: `pg_isready`

Alpha 2 does not yet ship object-storage replication, SAML, audit export,
disaster-recovery automation, or isolated execution sandboxes. The runner
protocol coordinates work; operators remain responsible for sandboxing runner
processes and protecting runner credentials.
