# TenantDeck

**Multi-Tenant Microsoft 365 Audit Console for MSPs** — GDAP-powered auditing, baseline compliance and licensing intelligence across every managed tenant, with a guarded write pattern proven on Exchange connectors.

Internal tool — Affinity IT Engineering.

## What it does

TenantDeck connects once to the partner tenant, discovers every GDAP customer relationship, and synchronises directory, licensing and Exchange data into a local encrypted cache. Modules:

| Module | Purpose |
| --- | --- |
| Tenant Registry | Bulk GDAP discovery and onboarding via an editable staging grid |
| Audit Engine | Baseline compliance checks, severity-weighted scores, league table |
| Connector Deployment | Template-driven bulk Exchange connector deployment — stage → validate → dry-run → preview → deploy → snapshot → rollback |
| Identity & Users | Cross-tenant user inventory: admin roles, MFA, last sign-in |
| Licensing | SKU friendly names, assigned vs purchased, unassigned waste |
| Groups & Teams | Ownerless/empty group hygiene across tenants |
| Domains | Live SPF / DKIM / DMARC DNS validation |
| Exchange | Mailbox inventory and external-forwarding audit |
| Reports | CSV export from every grid (branded PDF builder: Phase 7) |
| Global Search | Type-ahead across users, groups, mailboxes, domains, tenants |

## Architecture

- **Shell**: Electron (contextIsolation on, nodeIntegration off, sandboxed renderer)
- **UI**: React 18 + TypeScript + Vite, TanStack Table/Query
- **Main process**: all Graph/EXO calls, token handling and DB access; renderer talks via typed IPC only (`src/shared/ipc.ts`)
- **Auth**: `@azure/msal-node` public client (Microsoft first-party, pre-consented — default: Microsoft Graph Command Line Tools). Auth code + PKCE via the system browser; refresh token encrypted with Electron `safeStorage` (DPAPI/libsecret). **No app registration, no client secret, zero footprint in customer tenants.**
- **Data**: `better-sqlite3` local cache, tenant_id-keyed, encryption key held in OS secure storage
- **EXO engine**: PowerShell 7 + ExchangeOnlineManagement, `Connect-ExchangeOnline -DelegatedOrganization` per tenant under the signed-in engineer's identity
- **Packaging**: electron-builder → NSIS `.exe` (x64) + `.deb` (x64), electron-updater from GitHub Releases

## Security stance

Read-only everywhere except the Exchange Connector Deployment module. Every connector write passes through dry-run diff and PowerShell preview, supports disabled / EFTestMode staging, snapshots the tenant's full connector state before any change, and is reversible per tenant with one click. Bulk deploys above a configurable tenant count require typed confirmation. Every cmdlet execution is recorded in the audit log with who/when/template/parameters.

## Development

```bash
npm install
npm run dev          # Vite dev server + Electron
npm run typecheck    # main + renderer tsconfigs
npm test             # Vitest unit tests
npm run lint
npm run build        # typecheck + renderer + main bundles
npm run package      # electron-builder, unsigned local artifacts
```

PowerShell 7 (`pwsh`) with the `ExchangeOnlineManagement` module must be on PATH for Exchange features in dev; packaged builds will bundle a managed runtime under `resources/pwsh`.

## Release

Every push to `main` releases automatically: `.github/workflows/release.yml` bumps the patch version (committing `chore: release vX.Y.Z` back to main and tagging it), runs a Windows + Linux build matrix, and attaches both installers plus the electron-updater manifests to a GitHub Release. Installed clients pick the new version up silently via electron-updater.

For a minor/major bump, run `npm version minor` (or `major`) locally and push — the workflow's patch bump then continues from there. No Microsoft secrets exist in CI — the app is a public client.

## GDAP roles required

| Capability | Minimum role |
| --- | --- |
| Audit, identity, groups, domains, Exchange read | Global Reader |
| Licensing | Global Reader (Directory Readers acceptable) |
| Usage reports | Reports Reader or Global Reader |
| Connector deployment (write) | Exchange Administrator |

The Tenant Registry pre-flight validator names missing roles per tenant before commit, and warns when a relationship grants more than the enabled modules need.

## Project status

Phases 1–3 of the [project plan](docs/) are implemented (foundation, authentication, tenant registry) plus the core of phases 4–6: sync engine with Graph collectors, audit engine with the default baseline, DNS mail-auth checks, and the full guarded write pattern for connector deployment. Remaining: bundled pwsh runtime, drift detection scheduling, branded PDF reports, app lock, and release hardening.
