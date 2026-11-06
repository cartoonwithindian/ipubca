# Deployment

## Pipeline (Appwrite Cloud)

```bash
cp .env.example .env   # + real credentials
npm ci
npm run setup          # schema, indexes, buckets, admin team   (idempotent)
npm run deploy         # 8 functions: bundle → create/update → zip → activate (idempotent)
npm run verify         # full integration suite
```

`deploy-functions.js` bundles `functions/_shared/lib.js` into each function, zips the folder (excluding node_modules) and uploads an active deployment. Re-running replaces code atomically (Appwrite keeps previous deployments for rollback in Console).

## What deploy configures

| Function | execute | timeout | schedule |
|---|---|---|---|
| importpyqjson | team:pyqadmins | 300 s | — |
| createanswersubmission | users | 60 s | — |
| publishanswer / rejectanswer | team:pyqadmins | 60 s | — |
| deleteanswer | users | 60 s | — |
| reportanswer | users | 30 s | — |
| adminusermanagement | users | 60 s | — |
| cleanuporphanedfiles | team + scheduler | 300 s | `0 0 * * *` |

## First admin

See APPWRITE_SETUP.md §6. Without an admin the moderation/import endpoints are unusable — bootstrap before go-live.

## Release checklist

- [ ] `.env` values are production project; key stored in secret manager, not a repo.
- [ ] `npm run verify` fully green (exit 0).
- [ ] Console → Auth: email/password on, your web domain in Origins; OAuth optional later.
- [ ] Console → Webhooks (optional): wire `executions` to monitor failures.
- [ ] Frontend env has ONLY endpoint+project (`npm run lint`-safe grep for `API_KEY` returns nothing).
- [ ] Rate-limit envs tuned (`LIMIT_*`) for expected traffic.

## Rollback / migration

- Roll back code: Console → function → Deployments → activate previous.
- Schema changes: attributes/indexes are additive via `setup.js` (it never deletes). Destructive changes need a new script + DATABASE_SCHEMA.md update.
- Self-hosting later: same scripts work against any Appwrite 1.8+ instance — change `APPWRITE_ENDPOINT`, keep IDs identical.

## Monitoring

- Function logs: Console → Functions → Executions (all functions log with `logging: true`).
- Import health: query `importJobs` where `status:failed`.
- Storage growth: orphan cleanup runs nightly; `deleted` count is in its execution logs.
