# Frontend Integration Contract

For the React agent. Everything the UI needs. Field/collection names are **frozen** — changes require updating this file and `types/entities.ts` together.

## 0. Constants

```ts
import { COLLECTIONS, BUCKETS, FUNCTIONS, ADMIN_TEAM_ID } from 'ipubca/types/entities';
// databaseId 'pyq_platform' · buckets 'answer_images','pyq_imports'
// functions: importpyqjson, createanswersubmission, publishanswer, rejectanswer,
//            deleteanswer, reportanswer, adminusermanagement, cleanuporphanedfiles
```

Frontend env (only these are safe): `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID`. **Never** the API key.

```ts
import { Client, Account, Databases, Storage, Functions, Query, ID, Permission, Role } from 'appwrite';
const client = new Client().setEndpoint(VITE_APPWRITE_ENDPOINT).setProject(VITE_APPWRITE_PROJECT_ID);
const account = new Account(client), db = new Databases(client),
      storage = new Storage(client), funcs = new Functions(client);
```

## 1. Authentication flow

```ts
await account.create(ID.unique(), email, password, name);   // sign up
await account.createEmailPasswordSession(email, password);  // log in
const me = await account.get();
// Immediately (idempotent): create the profile document
await funcs.createExecution(FUNCTIONS.adminUserManagement, JSON.stringify(
  { action: 'ensureProfile', displayName: me.name }));
await account.deleteSession('current');                     // log out
```

Role truth = `admins` array membership; get it from `ensureProfile`/`me` response (`profile.isAdmin`). Do not derive roles from emails or localStorage.

## 2. Public browse (direct database reads — guest allowed)

```ts
db.listDocuments(P, C.courses, [Query.equal('isActive', true), Query.limit(50)]);
db.listDocuments(P, C.semesters, [Query.equal('courseId', id), Query.orderAsc('semesterNumber')]);
db.listDocuments(P, C.subjects,  [Query.equal('semesterId', id), Query.cursorPaginate(true), Query.limit(25)]);
db.listDocuments(P, C.questions, [
  Query.equal('subjectId', s), Query.equal('unitId', u), Query.equal('year', 2024),
  Query.greaterThanOrEqual('marks', 8), Query.orderDesc('$createdAt'), Query.limit(20)]);
db.listDocuments(P, C.questions, [Query.search('boolean algebra')]);   // fulltext
```

Published answers for a question (guests only see published ones automatically):

```ts
db.listDocuments(P, C.answers, [Query.equal('questionId', q), Query.orderDesc('$createdAt'), Query.limit(20)]);
```

A student's own submissions (incl. pending):

```ts
db.listDocuments(P, C.answers, [Query.equal('userId', me.$id), Query.orderDesc('$createdAt')]);
```

Always paginate (`Query.limit` ≤ 100 + `Query.cursorAfter/cursorBefore` with `cursorPaginate(true)`). Never fetch whole collections.

## 3. Answer images — upload flow

1. Client validates: type jpeg/png/webp, ≤ 15 MB, ≤ 10 files, keep chosen order.
2. Upload each file with **private** permissions:

```ts
const file = await storage.createFile(P_B, ID.unique(), blob, [
  Permission.read(Role.user(me.$id)),
  Permission.read(Role.team(ADMIN_TEAM_ID)),
  Permission.update(Role.user(me.$id)),
]);
```

3. Submit: `createAnswerSubmission` with `imageFileIds` in display order (server re-verifies ownership/type — uploads are useless to others).
4. Viewing:

```ts
// Published answers only; returns URL valid for guests:
storage.getFileView(P_B, fileId);        // <endpoint>/storage/buckets/answer_images/files/<id>/view?project=…
```

Pending images are **not** accessible to guests (per-file permissions enforce it); use the same `getFileView` — it works for the author/admin while pending.

## 4. Function contracts (exec with session — bodies/returns)

All responses: `{ ok: true, … }` or `{ ok: false, error: { code, message, httpStatus } }`.

### createanswersubmission (Users)
```ts
// create → 201 { submission: { $id, status:'pending' }, notice }
{ action:'create', questionId, explanation, imageFileIds?: string[] }
// update own pending/rejected → back to 'pending'
{ action:'update', submissionId, explanation, imageFileIds? }
```
Errors: `QUESTION_NOT_FOUND INVALID_IMAGE IMAGE_NOT_OWNED TOO_MANY_IMAGES RATE_LIMITED ACCOUNT_SUSPENDED NOT_EDITABLE`.

### publishanswer / rejectanswer (Admin)
```ts
{ submissionId, note? } → { submission: { $id, status } }   // publish also flips image perms
{ submissionId, reason } → { submission: { $id, status: 'rejected' } }  // reason required
```

### deleteanswer (owner-unpublished or Admin) — `{ submissionId }` → `{ deleted, imagesRemoved }`. `PUBLISHED_DELETE` blocks authors; others get `FORBIDDEN`.

### reportanswer (Users)
```ts
{ submissionId, reason: 'inappropriate'|'wrong_answer'|'plagiarism'|'spam'|'other', description? }
→ { report: { $id, status:'pending' } }   // ALREADY_REPORTED / RATE_LIMITED / INVALID_REASON
```

### importpyqjson (Admin)
```ts
{ fileIds?: string[], documents?: PyqImportDocument[],
  options?: { autoCreate?: true, dryRun?: false, upsert?: false } }
→ { summary, jobs[], reports[] }        // see JSON_IMPORT_SCHEMA.md; large files: upload to pyq_imports first
```

### adminusermanagement (Users; some actions admin-gated)
```ts
{ action:'ensureProfile', displayName } → { profile }            // self
{ action:'me' }                         → { profile, isAdmin }   // self
{ action:'list', page?, pageSize? }     → { total, profiles[] }  // admin
{ action:'setRole', userId, role }      → { profile }            // admin (team membership is authoritative)
{ action:'setStatus', userId, status }  → { profile }            // admin
```

### cleanuporphanedfiles (Admin/scheduler) — `{}` → `{ scanned, deleted }`.

## 5. Admin-only admin panels also need

- Pending moderation queue: `db.listDocuments(P, C.answers, [Query.equal('status','pending'), Query.orderAsc('$createdAt')])` — returns only for admins (doc perms).
- Reports queue: `[Query.equal('status','pending')]` (reporter + admin can read).
- Import history: list `importJobs` (admin read).

## 6. Error handling (UI)

```ts
const r = JSON.parse(execution.responseBody);
if (!r.ok) toast(r.error.message); // codes in types/entities.ts; httpStatus 401 → redirect to login
```

`429 RATE_LIMITED` bodies include retry guidance in `message`. `FORBIDDEN` ⇒ hide the control, don't just toast.

## 7. Do / Don't summary

- ✔ Read public data directly; paginate; use `Query.search` for search UI.
- ✔ Upload images privately, then call the function.
- ✘ Never write documents/statuses directly, never pass `role`/`userId` you expect the server to trust, never embed the server key, never fetch full collections.
