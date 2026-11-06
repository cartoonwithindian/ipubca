# Environment Setup

## Backend (this repo)

```bash
git clone https://github.com/cartoonwithindian/ipubca
cd ipubca
cp .env.example .env      # fill in real values — .env is gitignored
npm ci
```

`.env` variables (see `.env.example` for all defaults):

| Var | Required | Notes |
|---|---|---|
| APPWRITE_ENDPOINT | ✔ | region URL ending `/v1` |
| APPWRITE_PROJECT_ID | ✔ | Console → your project |
| APPWRITE_API_KEY | ✔ | server key, scopes: databases, storage, users, teams, functions. **Never** in frontend |
| APPWRITE_DATABASE_ID / collection / bucket / function IDs | — | defaults match provisioning; change only together with docs |
| APPWRITE_ADMIN_TEAM_ID | — | default `pyqadmins` |

Security rules:

- Never commit `.env` or real keys; rotate any key pasted into chat/PRs immediately.
- The `.env` → function-env mapping happens once in `npm run deploy`; browsers never receive these values.

## Frontend (React app)

Only two variables are needed:

```
VITE_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=<same project id>
```

Copy `types/entities.ts` into the frontend (or import via workspace) instead of re-declaring IDs.

## Verify your setup

```bash
npm test        # offline unit tests
npm run setup   # idempotent provisioning
npm run deploy  # bundle + upload functions
npm run verify  # live end-to-end security & feature suite
```
