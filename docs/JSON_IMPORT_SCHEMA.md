# PYQ JSON Import Format — schemaVersion `1.0`

Canonical machine schema: [`schemas/pyq-import.schema.json`](../schemas/pyq-import.schema.json) (draft-07).
Example files: [`samples/`](../samples/).

## Document shape

```json
{
  "schemaVersion": "1.0",
  "course":   { "name": "BCA", "code": "BCA" },
  "semester": 3,
  "subject":  { "name": "Computer Organization and Architecture", "code": "BCA209" },
  "questions": [
    {
      "id": "COA-2024-001",
      "year": 2024,
      "unit": 1,
      "topic": "Boolean Algebra",
      "questionNumber": "1(a)",
      "questionText": "Explain Boolean Algebra and its laws.",
      "questionType": "long",
      "marks": 10,
      "metadata": { "difficulty": "medium", "repeatYears": [2019, 2023] }
    }
  ]
}
```

| Field | Rules |
|---|---|
| schemaVersion | must be `"1.0"` (versioned — future versions extend, never break) |
| course.code / subject.code | `/^[A-Za-z0-9][A-Za-z0-9._-]{1,14}$/`, uppercased internally |
| semester | integer 1–12 |
| questions | 1…5000 per file |
| id | required, unique **within the subject** (not assumed globally unique — collisions are detected and reported) |
| year | 1980…current+5 · unit 1–12 · marks 0–100 |
| questionType | `very_short` \| `short` \| `mcq` \| `long` |
| topic | optional string; auto-created under the unit when missing |
| metadata | optional object; stored serialized |

## Import semantics (importPyqJson)

Request (executed as admin):

```json
{
  "fileIds": ["<uploaded to pyq_imports bucket>"],
  "documents": [ {…inline doc…} ],
  "options": { "autoCreate": true, "dryRun": false, "upsert": false }
}
```

- **Multiple files**: pass many fileIds and/or inline documents in one execution; each file yields its own `importJobs` row + report.
- **Validation order**: JSON parse → schema validation (file-level fail ⇒ recorded, nothing imported) → reference resolution → per-question import. Invalid records are **always** counted + listed in `report.errors` — never silently discarded.
- **autoCreate** (default true): missing course/semester/subject/unit/topic are created; when false, missing references mark affected questions invalid with messages.
- **Duplicate detection** (`dedupeKey`):
  `SUBJECTCODE|year|unit|alnum(questionNumber)[:12]|sha1(normalize(questionText).lower())[:16]`
  Normalization = trim + collapse whitespace. Question text is case/spacing-insensitive for duplicates.
- **Idempotency**: document `$id = "q" + sha1(dedupeKey)[:32]` + unique index on `dedupeKey` ⇒ re-importing the same file produces 0 imports / N duplicates, safe retries, safe partial re-runs.
- **upsert**: when true, a record whose *content* changed (same dedupe identity) updates in place instead of being counted duplicate; a changed question **text** creates a new identity, matched by `externalId` — with upsert it updates the old question, otherwise it's reported as an `external id collision` (fix the JSON `id` or set upsert).
- **dryRun**: full validation + counting, zero writes.

## Response

```json
{
  "ok": true,
  "summary": { "filesProcessed": 2, "imported": 12, "duplicates": 5, "invalid": 1 },
  "jobs":    [ { "jobId": "…", "fileName": "coa.json", "status": "completed_with_errors" } ],
  "reports": [ { "fileName": "coa.json", "totalQuestions": 13, "imported": 12, "duplicates": 0,
                 "skipped": 0, "invalid": 1,
                 "errors": [ { "id": "COA-2024-013", "message": "questions[12].marks: integer 0-100." } ] } ]
}
```

Job statuses: `completed` · `completed_with_errors` · `completed_duplicates_only` · `failed`. Full per-file report is persisted in `importJobs.report` (import history is queryable by `status` / `importedBy`).

## Guidance for producers

1. One file = one subject (schema groups all questions under a single subject block).
2. Keep `id` stable across exports so `upsert` behaves.
3. MCQs: put options inside `metadata.options: ["a","b","c","d"]`, answer key in `metadata.answer`.
4. New semesters/subjects need no pre-creation — autoCreate handles it (admins may pre-seed for control).
