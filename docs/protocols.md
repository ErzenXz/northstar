# Runner, status, and webhook protocols

Alpha 2 exposes intentionally small HTTP contracts so CI systems can integrate
without reaching into Origin's database. All JSON requests use
`Content-Type: application/json`.

## Access and runner credentials

Create a personal access token in **Settings → Tokens**. Send it as
`Authorization: Bearer org_…` when registering a runner, reporting a status, or
queueing a job. Origin stores only the SHA-256 digest.

Register a runner with an organization slug, a recognizable name, and the
labels describing its capabilities:

```http
POST /api/runners/register
Authorization: Bearer org_…

{"organization":"acme","name":"build-room-01","labels":["linux","docker"],"version":"0.2.0"}
```

The response contains a one-time `orr_…` runner credential. A coordinator can
queue work at `POST /api/repos/{owner}/{repo}/runner-jobs`. The runner polls
`POST /api/runners/jobs/claim` with its runner credential and receives the
oldest queued job whose required labels are a subset of its own. Claiming uses
`FOR UPDATE SKIP LOCKED`, so concurrent runners cannot receive the same job.

Complete a claimed job at `POST /api/runners/jobs/{id}/complete`:

```json
{"status":"completed","result":{"exitCode":0,"summary":"Checks passed"}}
```

Use `"status":"failed"` for failed work. Origin coordinates claims and records
structured results; Alpha 2 does not execute the payload or provide a sandbox.

## Commit statuses

Report a check against an exact commit:

```http
POST /api/repos/{owner}/{repo}/statuses/{sha}
Authorization: Bearer org_…

{"context":"ci/test","state":"success","description":"142 tests passed","targetUrl":"https://ci.example/run/42"}
```

`state` is `pending`, `success`, `failure`, or `error`. The public `GET` route at
the same path returns the latest record for each context. Pull-request merge
gates use the current head SHA, and approvals are also bound to that SHA, so a
new push requires fresh evidence and review.

## Webhooks

Repository members create subscriptions under **Repository Settings →
Webhooks**. Origin sends a JSON `POST` with these headers:

- `X-Origin-Event`: subscribed event name
- `X-Origin-Delivery`: unique delivery UUID
- `X-Origin-Signature-256`: `sha256=` followed by the HMAC-SHA256 body digest

Verify the signature against the exact request bytes before parsing JSON.
Deliveries have a ten-second timeout, do not follow redirects, reject URL
credentials, and fail closed when DNS resolves any address to a loopback,
link-local, or private network. Delivery status and the first 2,000 response
characters remain visible in repository settings.
