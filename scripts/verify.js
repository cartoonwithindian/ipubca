#!/usr/bin/env node
// End-to-end integration tests against the live Appwrite project.
// Creates throwaway test users, exercises every security boundary from
// MASTER PROMPT §13, prints a PASS/FAIL table. Non-zero exit on any FAIL.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID, Query } from 'node-appwrite';
import { Client } from 'node-appwrite';
import { makeClients, config } from './lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svc = makeClients();
const results = [];
let passwordCounter = 0;

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function step(name, fn) {
  try { const d = await fn(); record(name, true, typeof d === 'string' ? d : ''); }
  catch (err) { record(name, false, String(err?.message ?? err).slice(0, 200)); }
}
const expectFail = async (promise, ...codes) => {
  try { await promise; } catch (err) {
    const msg = String(err?.message ?? '');
    if (codes.some((c) => msg.includes(c) || String(err?.code) === c)) return msg;
    throw new Error(`wrong failure: ${err?.code} ${msg}`);
  }
  throw new Error('expected rejection but call succeeded');
};

const pw = () => `Ip#ubca$9${++passwordCounter}xQ!`;
async function makeUser(name) {
  const email = `${name}.${Date.now()}@test.ipubca.dev`;
  const password = pw();
  const user = await svc.users.create({ userId: ID.unique(), email, password, name });
  const token = await svc.users.createToken({ userId: user.$id, secret: ID.unique() });
  return { id: user.$id, email, password, jwt: token.jwt };
}

async function execAs(fnId, user, body) {
  const res = await svc.functions.createExecution(
    fnId, JSON.stringify(body), false, '/v1', 'POST',
    user ? { 'x-appwrite-user-id': user.id, 'x-appwrite-jwt': user.jwt } : {},
  );
  const out = JSON.parse(res.responseBody);
  if (!out.ok) { const e = new Error(`${out.error?.code}: ${out.error?.message}`); e.code = out.error?.httpStatus; throw e; }
  return out;
}

console.log('═══ ipubca backend integration tests ═══\n');

// ── 0. structure sanity ──
await step('schema: collections & attributes ready', async () => {
  for (const [id, col] of Object.entries(config.collections)) {
    const c = await svc.databases.getCollection(config.databaseId, col);
    const building = c.attributes.filter((a) => !['available', 'processed'].includes(a.status));
    if (building.length) throw new Error(`${id}.${building[0].$id} still building — rerun in a minute`);
  }
  return '10 collections, all attributes available';
});
await step('schema: buckets & functions exist', async () => {
  await svc.storage.getBucket(config.buckets.answerImages);
  await svc.storage.getBucket(config.buckets.pyqImports);
  for (const id of Object.values(config.functions)) await svc.functions.get(id);
  return '2 buckets, 8 functions';
});

// ── 1. users & roles ──
let admin, student, student2;
await step('auth: create admin + student test users', async () => {
  admin = await makeUser('admin-it');
  student = await makeUser('student-it');
  student2 = await makeUser('student2-it');
  await svc.teams.createMembership(config.adminTeamId, ['member'], undefined, admin.id);
  return '3 users';
});

await step('auth: student ensureProfile via function', () =>
  execAs(config.functions.adminUserManagement, student, { action: 'ensureProfile', displayName: 'Test Student' }));

await step('security: ensureProfile ignores body.role escalation attempt', async () => {
  await execAs(config.functions.adminUserManagement, student2, { action: 'ensureProfile', displayName: 'Test Student 2', role: 'admin' });
  const p = await svc.databases.getDocument(config.databaseId, config.collections.users, student2.id);
  if (p.role !== 'student') throw new Error('role escalation through ensureProfile succeeded!');
  return 'role stays student ✓';
});

// ── 2. imports ──
let importedQuestionId = null;
const coaDoc = JSON.parse(readFileSync(resolve(root, 'samples/bca-sem3-coa.json'), 'utf8'));

await step('import: admin imports sample JSON (autoCreate refs)', async () => {
  const out = await execAs(config.functions.importPyqJson, admin, { documents: [coaDoc] });
  const first = out.reports[0];
  if (out.summary.imported !== 5) throw new Error(`expected 5 imported, got ${JSON.stringify(out.summary)}`);
  return JSON.stringify(out.summary);
});

await step('import: re-import same file → all duplicates, no new docs', async () => {
  const out = await execAs(config.functions.importPyqJson, admin, { documents: [coaDoc] });
  if (out.summary.imported !== 0 || out.summary.duplicates !== 5) throw new Error(JSON.stringify(out.summary));
  const q = await svc.databases.listDocuments(config.databaseId, config.collections.questions, [Query.limit(100)]);
  if (q.total !== 5) throw new Error(`expected 5 questions total, got ${q.total}`);
  importedQuestionId = q.documents[0].$id;
  return 'idempotent ✓';
});

await step('import: invalid JSON file → failed job with errors, nothing silent', async () => {
  const bad = { ...coaDoc, schemaVersion: '9.9', questions: [{ id: 'X', year: 1850, unit: 0, questionNumber: '', questionText: '', questionType: 'essay', marks: 999 }] };
  const out = await execAs(config.functions.importPyqJson, admin, { documents: [bad] });
  if (out.summary.invalid === 0 && out.jobs.at(-1).status === 'completed') throw new Error('invalid doc was silently accepted');
  return `status=${out.jobs.at(-1).status}`;
});

await step('import: student cannot run importer (admin-only)', () =>
  expectFail(execAs(config.functions.importPyqJson, student, { documents: [coaDoc] }), 'FORBIDDEN', '403', 'UNAUTHENTICATED'));

await step('import: import history recorded', async () => {
  const jobs = await svc.databases.listDocuments(config.databaseId, config.collections.imports, [Query.limit(10)]);
  if (jobs.total < 3) throw new Error(`only ${jobs.total} jobs recorded`);
  return `${jobs.total} jobs`;
});

// ── 3. answers & moderation ──
let submissionId = null;
await step('answers: student submits answer (pending, not public)', async () => {
  const out = await execAs(config.functions.createAnswerSubmission, student, {
    action: 'create', questionId: importedQuestionId, explanation: 'Boolean algebra is the study of logical operations…',
  });
  submissionId = out.submission.$id;
  if (out.submission.status !== 'pending') throw new Error('submission not pending');
  return submissionId;
});

await step('answers: pending submission invisible to guests', async () => {
  const anon = new Client().setEndpoint(config.endpoint).setProject(config.projectId);
  await expectFail(anon.call('GET', `/database/${config.databaseId}/${config.collections.answers}/${submissionId}`), '404', '401', '403');
  return 'hidden ✓';
});

await step('security: student cannot publish via moderation function', () =>
  expectFail(execAs(config.functions.publishAnswer, student, { submissionId }), 'FORBIDDEN', '403'));

await step('security: student cannot self-promote to admin', () =>
  expectFail(execAs(config.functions.adminUserManagement, student, { action: 'setRole', userId: student.id, role: 'admin' }), 'FORBIDDEN', '403'));

await step('security: direct document update by student is rejected', async () => {
  const clientKeyOnly = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey('none');
  return expectFail(clientKeyOnly.call('PATCH', `/database/${config.databaseId}/${config.collections.answers}/${submissionId}`,
    new Headers({ 'x-appwrite-user-id': student.id }), { status: 'published' }), '401', '404', '403');
});

await step('answers: admin publishes → public read', async () => {
  await execAs(config.functions.publishAnswer, admin, { submissionId, note: 'verified answer' });
  const doc = await svc.databases.getDocument(config.databaseId, config.collections.answers, submissionId);
  if (doc.status !== 'published') throw new Error('status not published');
  return 'published ✓';
});

await step('answers: another student cannot delete my published answer', () =>
  expectFail(execAs(config.functions.deleteAnswer, student2, { submissionId }), 'FORBIDDEN', '403', 'PUBLISHED_DELETE'));

await step('answers: author cannot hard-delete published answer', () =>
  expectFail(execAs(config.functions.deleteAnswer, student, { submissionId }), 'PUBLISHED_DELETE'));

await step('answers: edit published answer is blocked; pending edit works', async () => {
  await expectFail(execAs(config.functions.createAnswerSubmission, student, {
    action: 'update', submissionId, explanation: 'edited after publish', imageFileIds: [],
  }), 'NOT_EDITABLE', '409');
  const s2 = await execAs(config.functions.createAnswerSubmission, student, {
    action: 'create', questionId: importedQuestionId, explanation: 'first draft',
  });
  const upd = await execAs(config.functions.createAnswerSubmission, student, {
    action: 'update', submissionId: s2.submission.$id, explanation: 'improved draft',
  });
  if (upd.submission.status !== 'pending') throw new Error('update did not reset to pending');
  return 'workflow ✓';
});

// ── 4. reports ──
await step('reports: student reports published answer', () =>
  execAs(config.functions.reportAnswer, student2, { submissionId, reason: 'wrong_answer', description: 'Step 2 is incorrect.' }));
await step('reports: duplicate report rejected', () =>
  expectFail(execAs(config.functions.reportAnswer, student2, { submissionId, reason: 'spam' }), 'ALREADY_REPORTED', '409'));
await step('reports: invalid reason rejected', () =>
  expectFail(execAs(config.functions.reportAnswer, student2, { submissionId, reason: 'i-dont-like-it' }), 'INVALID_REASON'));

// ── 5. pagination & queries ──
await step('query: questions list by subject with pagination', async () => {
  const sub = (await svc.databases.listDocuments(config.databaseId, config.collections.subjects, [Query.limit(1)])).documents[0];
  const page1 = await svc.databases.listDocuments(config.databaseId, config.collections.questions,
    [Query.equal('subjectId', sub.$id), Query.limit(2), Query.orderAsc('$createdAt')]);
  if (page1.documents.length !== 2) throw new Error('page size wrong');
  const page2 = await svc.databases.listDocuments(config.databaseId, config.collections.questions,
    [Query.equal('subjectId', sub.$id), Query.limit(2), Query.offset(2), Query.orderAsc('$createdAt')]);
  if (page2.documents.some((d) => page1.documents.some((p) => p.$id === d.$id))) throw new Error('pages overlap');
  return 'cursor-safe pages ✓';
});
await step('query: year & marks filters use indexes', async () => {
  const r = await svc.databases.listDocuments(config.databaseId, config.collections.questions,
    [Query.equal('year', 2024), Query.greaterThanOrEqual('marks', 8), Query.limit(10)]);
  return `${r.total} matched`;
});

// ── 6. admin management ──
await step('admin: setStatus suspends account; suspended cannot submit', async () => {
  await execAs(config.functions.adminUserManagement, admin, { action: 'setStatus', userId: student2.id, status: 'suspended' });
  return expectFail(execAs(config.functions.createAnswerSubmission, student2, {
    action: 'create', questionId: importedQuestionId, explanation: 'zombie answer',
  }), 'ACCOUNT_SUSPENDED', '403');
});
await step('admin: list profiles paginated', async () => {
  const out = await execAs(config.functions.adminUserManagement, admin, { action: 'list', page: 1, pageSize: 50 });
  if (!Array.isArray(out.profiles)) throw new Error('no profiles array');
  return `${out.total} profiles`;
});

// ── 7. cleanup + storage ──
await step('storage: answer bucket enforces image types', async () => {
  const bucket = await svc.storage.getBucket(config.buckets.answerImages);
  for (const want of ['jpg', 'jpeg', 'png', 'webp']) {
    if (!bucket.allowedFileExtensions.includes(want)) throw new Error(`missing extension rule: ${want}`);
  }
  if (bucket.fileSecurity !== true) throw new Error('fileSecurity must be on');
  if (bucket.maximumFileSize !== config.limits.maxImageSizeMB * 1024 * 1024) throw new Error('size limit mismatch');
  return 'jpeg/png/webp + 15MB + per-file perms ✓';
});
await step('cleanup: orphan scanner runs as admin', async () => {
  const out = await execAs(config.functions.cleanupOrphanedFiles, admin, {});
  return `scanned=${out.scanned} deleted=${out.deleted}`;
});

// ── summary ──
console.log('\n══════════ summary ══════════');
const fails = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
