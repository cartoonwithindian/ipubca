#!/usr/bin/env node
// Idempotent provisioning of the ipubca Appwrite backend.
// Safe to run repeatedly: existing resources are skipped, never destroyed.
import { makeClients, ensure, ADMIN_R, Permission, Role, ID, Query, config } from './lib.js';
import { Databases, Storage, Teams } from 'node-appwrite';

const { client, databases, storage, teams } = makeClients();
const db = config.databaseId;
const C = config.collections;
const adminTeam = Role.team(config.adminTeamId);
const publicRead = [Permission.read(Role.any())];
const adminWrite = [Permission.create(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)];

// ── schema spec ─────────────────────────────────────────────────────────
// t: string|text|int|bool ; req: required ; arr: array
const str = (key, size, opts = {}) => ({ key, t: 'string', size, ...opts });
const txt = (key, opts = {}) => ({ key, t: 'text', ...opts });
const int = (key, opts = {}) => ({ key, t: 'int', ...opts });
const bool = (key, opts = {}) => ({ key, t: 'bool', ...opts });

const SCHEMA = {
  [C.users]: {
    security: true,
    perms: [Permission.create(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)],
    attrs: [
      str('userId', 64), str('displayName', 100), str('email', 100, { req: false }),
      str('role', 20, { default: 'student' }), str('status', 20, { default: 'active' }),
    ],
    indexes: [
      { key: 'idx_users_role', type: 'key', attrs: ['role'] },
      { key: 'idx_users_email', type: 'unique', attrs: ['email'] },
    ],
  },
  [C.courses]: {
    security: false, perms: [...publicRead, ...adminWrite],
    attrs: [str('name', 100), str('code', 30), txt('description', { req: false }), bool('isActive', { default: true })],
    indexes: [{ key: 'idx_courses_code', type: 'unique', attrs: ['code'] }],
  },
  [C.semesters]: {
    security: false, perms: [...publicRead, ...adminWrite],
    attrs: [str('courseId', 64), int('semesterNumber', { min: 1, max: 12 }), str('name', 100), bool('isActive', { default: true })],
    indexes: [
      { key: 'idx_sem_course', type: 'key', attrs: ['courseId'] },
      { key: 'idx_sem_course_num', type: 'unique', attrs: ['courseId', 'semesterNumber'] },
    ],
  },
  [C.subjects]: {
    security: false, perms: [...publicRead, ...adminWrite],
    attrs: [str('courseId', 64), str('semesterId', 64), str('subjectName', 100), str('subjectCode', 30),
      txt('description', { req: false }), txt('syllabus', { req: false }), bool('isActive', { default: true })],
    indexes: [
      { key: 'idx_subj_sem', type: 'key', attrs: ['semesterId'] },
      { key: 'idx_subj_code', type: 'key', attrs: ['subjectCode'] },
      { key: 'idx_subj_unique', type: 'unique', attrs: ['semesterId', 'subjectCode'] },
    ],
  },
  [C.units]: {
    security: false, perms: [...publicRead, ...adminWrite],
    attrs: [str('subjectId', 64), int('unitNumber', { min: 1, max: 12 }), str('title', 100), txt('description', { req: false })],
    indexes: [
      { key: 'idx_unit_subj', type: 'key', attrs: ['subjectId'] },
      { key: 'idx_unit_subj_num', type: 'unique', attrs: ['subjectId', 'unitNumber'] },
    ],
  },
  [C.topics]: {
    security: false, perms: [...publicRead, ...adminWrite],
    attrs: [str('unitId', 64), str('title', 100), txt('description', { req: false })],
    indexes: [
      { key: 'idx_topic_unit', type: 'key', attrs: ['unitId'] },
      { key: 'idx_topic_unit_title', type: 'unique', attrs: ['unitId', 'title'] },
    ],
  },
  [C.questions]: {
    security: false, perms: [...publicRead, ...adminWrite],
    attrs: [
      str('courseId', 64), str('semesterId', 64), str('subjectId', 64), str('unitId', 64),
      str('topicId', 64, { req: false }), str('externalId', 100), str('dedupeKey', 100),
      txt('questionText'), str('questionType', 20), int('year', { min: 1900, max: 2100 }),
      int('marks', { min: 0, max: 100 }), str('questionNumber', 50),
      str('sourceFile', 100, { req: false }), str('jobId', 64, { req: false }),
      txt('metadata', { req: false }),
    ],
    indexes: [
      { key: 'idx_q_dedupe', type: 'unique', attrs: ['dedupeKey'] },
      { key: 'idx_q_subject_unit', type: 'key', attrs: ['subjectId', 'unitId'] },
      { key: 'idx_q_course_sem', type: 'key', attrs: ['courseId', 'semesterId'] },
      { key: 'idx_q_subject_year', type: 'key', attrs: ['subjectId', 'year'] },
      { key: 'idx_q_year', type: 'key', attrs: ['year'] },
      { key: 'idx_q_marks', type: 'key', attrs: ['marks'] },
      { key: 'idx_q_type', type: 'key', attrs: ['questionType'] },
      { key: 'idx_q_topic', type: 'key', attrs: ['topicId'] },
      { key: 'idx_q_external', type: 'key', attrs: ['externalId'] },
      { key: 'idx_q_text_ft', type: 'fulltext', attrs: ['questionText'] },
    ],
  },
  [C.answers]: {
    security: true,
    perms: [Permission.create(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)],
    attrs: [
      str('questionId', 64), str('userId', 64), str('displayName', 100),
      txt('explanation'), str('imageFileIds', 64, { req: false, arr: true }),
      str('status', 20, { default: 'pending' }), str('moderatedBy', 64, { req: false }),
      txt('moderationNote', { req: false }),
    ],
    indexes: [
      { key: 'idx_ans_question_status', type: 'key', attrs: ['questionId', 'status'] },
      { key: 'idx_ans_user', type: 'key', attrs: ['userId', 'status'] },
      { key: 'idx_ans_status', type: 'key', attrs: ['status'] },
    ],
  },
  [C.reports]: {
    security: true,
    perms: [Permission.create(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)],
    attrs: [
      str('submissionId', 64), str('reporterId', 64), str('reason', 50),
      txt('description', { req: false }), str('status', 20, { default: 'pending' }),
      str('resolvedBy', 64, { req: false }),
    ],
    indexes: [
      { key: 'idx_rep_submission', type: 'key', attrs: ['submissionId'] },
      { key: 'idx_rep_status', type: 'key', attrs: ['status'] },
      { key: 'idx_rep_reporter', type: 'key', attrs: ['reporterId'] },
    ],
  },
  [C.imports]: {
    security: false, perms: [ADMIN_R, Permission.create(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)],
    attrs: [
      str('fileName', 100), str('importedBy', 64),
      int('totalQuestions'), int('successfulQuestions'), int('failedQuestions'),
      int('skippedQuestions'), int('duplicateQuestions'),
      str('status', 20, { default: 'completed' }), txt('report', { req: false }),
    ],
    indexes: [
      { key: 'idx_import_status', type: 'key', attrs: ['status'] },
      { key: 'idx_import_by', type: 'key', attrs: ['importedBy'] },
    ],
  },
};

async function createAttribute(d, collectionId, a) {
  const req = a.req !== false;
  if (a.t === 'string') return d.createStringAttribute(db, collectionId, a.key, a.size, req, a.default ?? null, !!a.arr);
  if (a.t === 'text') return d.createTextAttribute(db, collectionId, a.key, req, a.default ?? null, !!a.arr);
  if (a.t === 'int') return d.createIntegerAttribute(db, collectionId, a.key, req, a.min ?? null, a.max ?? null, a.default ?? null);
  if (a.t === 'bool') return d.createBooleanAttribute(db, collectionId, a.key, req, a.default ?? null);
  throw new Error(`unknown attr type ${a.t}`);
}

console.log('▸ Admin team');
await ensure(`team ${config.adminTeamId}`, () => teams.create(config.adminTeamId, 'Platform Admins'));

console.log('▸ Database');
await ensure(`database ${db}`, () => databases.create(db, 'PYQ Platform'));

for (const [collectionId, spec] of Object.entries(SCHEMA)) {
  console.log(`▸ Collection ${collectionId}`);
  await ensure(`collection ${collectionId}`, () =>
    databases.createCollection(db, collectionId, collectionId, spec.perms, spec.security, true));
  // Attributes must become available before indexes that reference them.
  const pending = [];
  for (const a of spec.attrs) {
    pending.push(ensure(`  attr ${collectionId}.${a.key}`, () => createAttribute(databases, collectionId, a)));
  }
  await Promise.all(pending);
  // Appwrite needs the attributes to finish building before indexes can be created.
  await waitForAttributes(collectionId, spec.attrs.length);
  for (const ix of spec.indexes) {
    await ensure(`  index ${ix.key}`, () => databases.createIndex(db, collectionId, ix.key, ix.type, ix.attrs));
  }
}

async function waitForAttributes(collectionId, count) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const col = await databases.getCollection(db, collectionId);
    const status = {};
    for (const a of col.attributes) status[a.key] = a.status;
    const allDone = Object.values(status).every((s) => s === 'available' || s === 'processed');
    const expecting = count >= 0;
    if (allDone) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

console.log('▸ Storage buckets');
await ensure('bucket answer_images', () => storage.createBucket(
  config.buckets.answerImages, 'Answer Images',
  [Permission.create(Role.users()), Permission.read(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)],
  true, true,
  config.limits.maxImageSizeMB * 1024 * 1024,
  ['jpg', 'jpeg', 'png', 'webp'], 'gzip', false, false));

await ensure('bucket pyq_imports', () => storage.createBucket(
  config.buckets.pyqImports, 'PYQ Import Files',
  [Permission.create(adminTeam), Permission.read(adminTeam), Permission.update(adminTeam), Permission.delete(adminTeam)],
  true, true,
  5 * 1024 * 1024,
  ['json'], 'gzip', false, false));

console.log('\nProvisioning complete. Next: npm run deploy');
