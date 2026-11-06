# Backend Architecture

BCA PYQ & Public Answer Sharing Platform — Appwrite backend.

## Overview

```
 React Frontend ──(Client SDK, user session)──► Appwrite Cloud
      │                                            │
      │ read public docs (courses…questions)       │ document security
      │ upload images (answer_images bucket)       │
      └── exec() functions (all writes) ───────────┤
                                                   ▼
                              ┌───────────────────────────────────┐
                              │ Appwrite Functions (node-22)      │
                              │  importPyqJson      createAnswer…│
                              │  publish/reject/    reportAnswer │
                              │  deleteAnswer       adminUser…   │
                              │  cleanupOrphanedFiles            │
                              └──────────────┬────────────────────┘
                                             │ server SDK + execution key
   ┌─────────────────────────────────────────┼────────────────────────┐
   ▼                                         ▼                        ▼
 Database `pyq_platform` (10 collections)  Storage (2 buckets)   Auth + Team `pyqadmins`
```

## Layers

1. **Direct reads** — public browse data (courses, semesters, subjects, units, topics, questions) and *published* answers are read straight from the Client SDK. Reads are indexed and paginated; no bulk downloads.
2. **All writes via Functions** — no client ever writes a document or changes a status directly. Functions validate the caller server-side (team `pyqadmins` membership = admin; everything else = student) using the request's real session, never client-provided role claims.
3. **Moderation pipeline** — submissions start `pending` with document permissions limited to author + admins. `publishAnswer` flips document and image permissions to public. Default is manual approval (no auto-publish).

## Key invariants

| Invariant | Mechanism |
|---|---|
| API key never in browser | All privileged ops run inside functions; frontend gets only endpoint/project id |
| Students can't self-publish | `answerSubmissions` docs give owners **read**, not update; status changes require admin in function |
| Pending answers invisible publicly | Per-document + per-file permissions (`fileSecurity: true` bucket) |
| Role escalation impossible | `role` attribute writable only via `adminUserManagement` (admin-gated); team membership is the real authority |
| Duplicate imports impossible | Unique `dedupeKey` (subject+year+unit+questionNumber+text-hash) + deterministic doc ids |
| No silent data loss | Every invalid/duplicate record is counted and stored in `importJobs.report` |

## Scaling notes

- Import is batch-friendly: one function execution per file, 5 000 questions/file max, timeout 300 s.
- List endpoints rely on composite key indexes (see DATABASE_SCHEMA.md) — never scan whole collections.
- `cleanupOrphanedFiles` runs on a schedule (`0 0 * * *`) and on-demand by admins.

See PERMISSIONS.md for the matrix, API_CONTRACT.md for the frontend contract.
