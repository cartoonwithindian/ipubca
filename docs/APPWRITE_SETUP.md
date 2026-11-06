# Appwrite Setup (one-time)

Target: **Appwrite Cloud** (any region). Runtime used: `node-22`. All steps are automated by `npm run setup && npm run deploy`; the manual console notes below are only needed for two things the API cannot do.

## 1. Create the project

1. console.appwrite.io → **Create project** `ipubca` (or your name).
2. Copy the **Project ID** into `.env` as `APPWRITE_PROJECT_ID`.
3. Set endpoint region in `.env` (`APPWRITE_ENDPOINT`), e.g. `https://fra.cloud.appwrite.io/v1`.

## 2. Create a server API key

Project → **API Credentials / Keys → Create a Server Key**:

- Name: `backend-provisioner`
- Scopes: `databases`, `storage`, `users`, `teams`, `functions`
- Expiration: set a renewal reminder (keys expire max 1 month? create short-lived keys and rotate).

Paste into `.env` as `APPWRITE_API_KEY`. **Never** put this key in the frontend or commit it.

## 3. Auth configuration (Console only)

Project → **Auth**:
- Enable **Email/Password** provider.
- Turn **block unknown users off** (default fine).
- (Optional) add your app domain under **Auth → Origin**.

## 4. Provision schema + buckets

```bash
npm ci
npm run setup
```

Idempotent — safe to re-run. Creates: team `pyqadmins`, database `pyq_platform`, 10 collections, all attributes, all indexes, buckets `answer_images` (15 MB, jpg/jpeg/png/webp, per-file security) and `pyq_imports` (5 MB, json, admin-only).

## 5. Deploy functions

```bash
npm run deploy
```

Creates/updates all 8 functions with env vars, uploads zipped code, activates, and schedules `cleanupOrphanedFiles` nightly. If your Appwrite plan requires it, allow **outbound access** / install defaults are fine (functions use `npm install` as build command).

## 6. Bootstrap the first admin (API can't self-grant)

After you create your admin account from the frontend (or Console → Users):

```bash
# run once with the provisioner key in .env
node -e "
import('node-appwrite').then(async ({Client, Teams}) => {
  const c = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
  const t = new Teams(c);
  await t.createMembership(process.env.APPWRITE_ADMIN_TEAM_ID || 'pyqadmins', ['member'], undefined, process.argv[2]);
  console.log('admin added');
}).catch(e => { console.error(e.message); process.exit(1); })
" <YOUR_USER_ID>
```

All later admins are promoted via `adminUserManagement` → `setRole`.

## 7. Verify

```bash
npm test          # importer unit tests (no credentials needed)
npm run verify    # live integration suite (needs .env)
```

## Function runtime key scopes

Deploy sets scopes `documents, storage, users, teams, functions` on each function. If you recreate functions manually in Console, keep these scopes and never grant `keys` or `projects`.
