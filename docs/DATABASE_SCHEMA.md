# Database Schema

Database ID: **`pyq_platform`**. Every document also has Appwrite system fields (`$id`, `$createdAt`, `$updatedAt`, `$permissions`).
`sec` = document-level security enabled (per-doc permissions win; collection permissions only gate *who may create docs through APIs*, which is function-only).

## users  (sec ✔, $id = Appwrite auth user id)

| attr | type | notes |
|---|---|---|
| userId | string(64) | mirror of auth id |
| displayName | string(100) | required |
| email | string(100) | optional, unique index |
| role | string(20) | `student`\|`admin`, default `student` — write only via adminUserManagement |
| status | string(20) | `active`\|`suspended`, default `active` |

Indexes: `idx_users_role` (role), `idx_users_email` (email, unique).

## courses (sec ✘, read: anyone, write: admin)

| attr | type |
|---|---|
| name | string(100) |
| code | string(30) — unique `idx_courses_code` |
| description | text |
| isActive | bool default true |

## semesters — `courseId` string(64), `semesterNumber` int(1-12), `name` string(100), `isActive` bool.
Indexes: `idx_sem_course`(courseId), `idx_sem_course_num`(courseId+semesterNumber, unique).

## subjects — `courseId`, `semesterId` string(64), `subjectName` string(100), `subjectCode` string(30), `description` text, `syllabus` text, `isActive` bool.
Indexes: `idx_subj_sem`(semesterId), `idx_subj_code`(subjectCode), `idx_subj_unique`(semesterId+subjectCode, unique).

## units — `subjectId` string(64), `unitNumber` int(1-12), `title` string(100), `description` text.
Indexes: `idx_unit_subj`(subjectId), `idx_unit_subj_num`(subjectId+unitNumber, unique).

## topics — `unitId` string(64), `title` string(100), `description` text.
Indexes: `idx_topic_unit`(unitId), `idx_topic_unit_title`(unitId+title, unique).

## questions (sec ✘)

| attr | type | notes |
|---|---|---|
| courseId / semesterId / subjectId / unitId | string(64) | |
| topicId | string(64) | optional |
| externalId | string(100) | `id` from the JSON file (unique **per subject**) |
| dedupeKey | string(100) | unique index, see JSON_IMPORT_SCHEMA.md |
| questionText | text | whitespace-normalized |
| questionType | string(20) | very_short\|short\|mcq\|long |
| year | int | 1980–2100 |
| marks | int | 0–100 |
| questionNumber | string(50) | e.g. `1(a)` |
| sourceFile | string(100) | |
| jobId | string(64) | import batch |
| metadata | text | JSON string or empty |

Doc `$id` = `q` + sha1(dedupeKey)[:32] → deterministic & idempotent.

Indexes: `idx_q_dedupe`(dedupeKey, unique), `idx_q_subject_unit`, `idx_q_course_sem`, `idx_q_subject_year`, `idx_q_year`, `idx_q_marks`, `idx_q_type`, `idx_q_topic`, `idx_q_external`(subjectId lookups), `idx_q_text_ft`(fulltext on questionText).

## answerSubmissions (sec ✔)

| attr | type | notes |
|---|---|---|
| questionId | string(64) | |
| userId | string(64) | author |
| displayName | string(100) | denormalized for public list views |
| explanation | text | ≤ 50 000 chars |
| imageFileIds | string(64)[] | ordered; ≤ 10 |
| status | string(20) | pending\|published\|rejected\|removed |
| moderatedBy | string(64) | admin id |
| moderationNote | text | |

Indexes: `idx_ans_question_status`(questionId+status), `idx_ans_user`(userId+status), `idx_ans_status`.

## reports (sec ✔) — `submissionId` string(64), `reporterId` string(64), `reason` string(50) enum, `description` text, `status` string(20) (`pending`→`reviewed`→`resolved`/`dismissed`), `resolvedBy` string(64).
Indexes: `idx_rep_submission`, `idx_rep_status`, `idx_rep_reporter`.

## importJobs (sec ✘, admin-only read)

`fileName` string(100), `importedBy` string(64), `totalQuestions`/`successfulQuestions`/`failedQuestions`/`skippedQuestions`/`duplicateQuestions` int, `status` string(20), `report` text (JSON: per-record errors).
Indexes: `idx_import_status`, `idx_import_by`.

## Appwrite-limit adaptations

- `text` attributes used where > 100 chars needed (string max).
- JSON payloads (`metadata`, `report`) stored as serialized `text` (attribute limit) — parse client-side.
- Arrays limited to `string(64)[]` (file ids) — max 10 enforced in function.
- 20 indexes/collection limit respected (max used: 10 on questions).
