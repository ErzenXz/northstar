# Origin Cloud boundary

Origin Cloud should be the easiest way to operate Origin, not the only way to
use its product capabilities.

Cloud modules may include:

- tenant provisioning and regional placement
- usage metering and billing
- managed AI model credentials and budgets
- isolated agent execution pools
- encrypted backups and restore drills
- enterprise SSO, SCIM, policy packs, and support tooling
- abuse prevention and fleet observability

The following stay in the open core:

- Git repository ownership and transport
- accounts, workspaces, permissions, and access tokens
- GitHub import and export paths
- issues and change records
- repository browsing and activity pulse
- repository memory and provider-neutral AI planning
- self-hosting manifests and database migrations

Hosted integrations must depend on stable interfaces from the core. Core code
must never import a billing or proprietary cloud package.
