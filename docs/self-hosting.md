# Self-hosting

The provided Compose deployment is a single-node alpha intended for evaluation
and trusted teams.

## Required production changes

1. Set independent, random `SESSION_SECRET` and `ORIGIN_ENCRYPTION_KEY` values.
2. Put the web and Git services behind TLS.
3. Replace default PostgreSQL credentials and enable encrypted backups.
4. Back up both PostgreSQL and the repository volume as one recovery unit.
5. Restrict worker egress to approved AI providers and import sources.
6. Configure request size, rate, and concurrency limits at the edge.
7. Do not expose future agent execution without isolated, disposable sandboxes.

The Git service is stateless apart from its database and repository-volume
dependencies. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, so multiple
workers may run safely when repository storage is shared.

## Health checks

- Web: `GET /api/health`
- Git: `GET /health`
- PostgreSQL: `pg_isready`

The first alpha does not yet ship object-storage replication, SSH transport,
SAML, audit export, or disaster-recovery automation.
