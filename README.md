# ipubca — BCA PYQ & Public Answer Sharing Platform (Appwrite Backend)

Production backend on Appwrite Cloud: authentication, 10-collection database, JSON PYQ
import pipeline (validated + idempotent), image-based answer submissions with a
moderation workflow, reporting, and admin management — secured by document-level
permissions and server-side role checks.

## Quick start

```bash
cp .env.example .env    # add APPWRITE_PROJECT_ID + APPWRITE_API_KEY
npm ci
npm run setup           # provision database, collections, indexes, buckets
npm run deploy          # create + deploy all 8 functions
npm run verify          # live integration test suite
npm test                # offline unit tests (import engine)
```

## Layout

```
scripts/       provisioning + deploy + integration verify (node-appwrite server SDK)
functions/     8 Appwrite Functions (node-22), shared lib in _shared/
schemas/       JSON Schema of the shared PYQ format (versioned)
samples/       real-shaped example import files
types/         entities.ts — frozen TS contract shared with the React frontend
docs/          the 8 backend documents (start with BACKEND_ARCHITECTURE.md)
tests/         import-engine unit tests
```

## Documentation

1. [Backend architecture](docs/BACKEND_ARCHITECTURE.md)
2. [Appwrite setup](docs/APPWRITE_SETUP.md)
3. [Database schema](docs/DATABASE_SCHEMA.md)
4. [Permissions matrix](docs/PERMISSIONS.md)
5. [JSON import schema](docs/JSON_IMPORT_SCHEMA.md)
6. [Frontend API contract](docs/API_CONTRACT.md)
7. [Environment setup](docs/ENVIRONMENT_SETUP.md)
8. [Deployment](docs/DEPLOYMENT.md)

## Security posture (summary)

- Server key exists only in `.env`/function runtime; frontend sees endpoint + project id only.
- Roles come from Appwrite **team membership**, never from client payloads; last-admin demotion blocked.
- Answers are `pending` (private: author + admins) until an admin publishes; publishing flips document **and image** permissions public.
- All writes go through functions that re-validate caller, ownership, file types, sizes, and rate limits.
