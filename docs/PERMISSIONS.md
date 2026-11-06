# Permissions Matrix

Two sources of truth, always evaluated together:

1. **Collection/bucket-level permissions** (set by `scripts/setup.js`).
2. **Server-side checks inside functions** — every function re-derives the caller from `x-appwrite-user-id` on the execution request and verifies admin status by **team `pyqadmins` membership**, never by trusting a client claim. `users.role` is a cache of that membership.

Roles: **Guest** = anonymous, **User** = any authenticated account, **Admin** = member of team `pyqadmins`.

## Database

| Collection | Read | Create / Update / Delete |
|---|---|---|
| courses, semesters, subjects, units, topics, questions | Guest (any) | Admin only |
| users | Owner + Admin (per-doc) | Admin only (created via function for self, role fixed `student`) |
| answerSubmissions | pending/rejected: author+admin · published: Guest | author creates via function; only admin updates status; delete via function |
| reports | reporter + admin (per-doc) | any authenticated user via reportAnswer |
| importJobs | Admin only | functions only (server key) |

Direct document writes from clients are **impossible** by design: collections with document security give clients no `update` permission, and public collections grant writes to the admin team only — the client SDK never holds the server key.

## Storage

| Bucket | Create | Read | Update/Delete |
|---|---|---|---|
| answer_images | authenticated users (`Role.users()`) with **fileSecurity on** — new files start private: author+admins | per file: author+admin while pending/rejected; **+ Guest when published** | author/admin |
| pyq_imports | Admin team only | Admin team only | Admin team only |

A student may technically mark their own uploaded file public (client controls upload perms) — the file is then unlinked to any submission and **deleted within 24 h by cleanupOrphanedFiles**, and it is never listed by any API. Published-answer images are only public when `publishAnswer` (admin) flips them.

## Functions (execute permission)

| Function | Executable by | Effective authority inside |
|---|---|---|
| createAnswerSubmission | Users | acts as caller; owner checks enforced |
| deleteAnswer | Users | owner (unpublished) or admin |
| reportAnswer | Users | acts as caller; dedupe + rate limit |
| adminUserManagement | Users (`ensureProfile`/`me` self-only) | admin required for list/setRole/setStatus |
| importPyqJson | Admin team | admin required |
| publishAnswer / rejectAnswer | Admin team | admin required |
| cleanupOrphanedFiles | Admin team + internal scheduler | server |

## Rate limits / abuse controls (function-level)

- 20 submissions per user per hour (`LIMIT_SUBMISSIONS_PER_HOUR`).
- 30 reports per user per day.
- 1 report per user per submission.
- ≤ 10 images ≤ 15 MB per submission; extension + MIME rechecked server-side.
- Suspended accounts (`setStatus`) are blocked from submitting and their Appwrite account is deactivated.

## Critical guarantees

- API key exists only in `.env` (gitignored) and inside function runtime env — never shipped to the browser.
- A student editing their own pending answer goes through the function; the document `update` permission is admin-only, so direct tampering (status flips, deleting others) fails at Appwrite's own authorization layer.
- Promotion to admin requires an existing admin; last-admin self-demotion is blocked (409 LAST_ADMIN).
