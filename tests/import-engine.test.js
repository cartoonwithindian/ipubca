import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, importDocument, computeDedupeKey, questionDocId } from '../functions/importPyqJson/src/engine.js';

const goodDoc = () => ({
  schemaVersion: '1.0',
  course: { name: 'BCA', code: 'BCA' },
  semester: 3,
  subject: { name: 'Computer Organization and Architecture', code: 'BCA209' },
  questions: [
    { id: 'COA-2024-001', year: 2024, unit: 1, topic: 'Boolean Algebra', questionNumber: '1(a)', questionText: 'Explain Boolean Algebra and its laws.', questionType: 'long', marks: 10 },
    { id: 'COA-2024-002', year: 2024, unit: 2, questionNumber: '2', questionText: 'Define cache memory.', questionType: 'short', marks: 5 },
  ],
});

function memDao(seed = {}) {
  const coll = (name, rows = []) => ({ name, rows });
  const state = {
    courses: coll('courses', seed.courses ?? []),
    semesters: coll('semesters', seed.semesters ?? []),
    subjects: coll('subjects', seed.subjects ?? []),
    units: coll('units', []),
    topics: coll('topics', []),
    questions: coll('questions', seed.questions ?? []),
    failNextCreate: false,
  };
  const push = (c, row) => {
    if (c.rows.some((r) => r.$id === row.$id)) { const e = new Error('ID_EXISTS document with the same ID already exists'); throw e; }
    c.rows.push(row); return row;
  };
  const dao = {
    state,
    findCourseByCode: async (code) => state.courses.rows.find((r) => r.code === code.toUpperCase()) ?? null,
    createCourse: async ({ name, code }) => push(state.courses, { $id: `c_${code}`, name, code: code.toUpperCase() }),
    findSemester: async (courseId, number) => state.semesters.rows.find((r) => r.courseId === courseId && r.semesterNumber === number) ?? null,
    createSemester: async (courseId, number) => push(state.semesters, { $id: `s_${courseId}_${number}`, courseId, semesterNumber: number }),
    findSubject: async (semesterId, code) => state.subjects.rows.find((r) => r.semesterId === semesterId && r.subjectCode === code.toUpperCase()) ?? null,
    createSubject: async (courseId, semesterId, { name, code }) => push(state.subjects, { $id: `sub_${code}`, courseId, semesterId, subjectName: name, subjectCode: code.toUpperCase() }),
    findUnit: async (subjectId, number) => state.units.rows.find((r) => r.subjectId === subjectId && r.unitNumber === number) ?? null,
    createUnit: async (subjectId, number) => push(state.units, { $id: `u_${subjectId}_${number}`, subjectId, unitNumber: number }),
    findTopic: async (unitId, title) => state.topics.rows.find((r) => r.unitId === unitId && r.title.toLowerCase() === title.trim().toLowerCase()) ?? null,
    createTopic: async (unitId, title) => push(state.topics, { $id: `t_${unitId}_${title}`, unitId, title }),
    findQuestionByDedupe: async (key) => state.questions.rows.find((r) => r.dedupeKey === key) ?? null,
    findQuestionByExternalId: async (subjectId, externalId) => state.questions.rows.find((r) => r.subjectId === subjectId && r.externalId === externalId) ?? null,
    createQuestion: async (id, data) => push(state.questions, { $id: id, ...data }),
    updateQuestion: async (id, data) => {
      const row = state.questions.rows.find((r) => r.$id === id);
      Object.assign(row, data); return row;
    },
  };
  return dao;
}

test('valid document passes validation', () => {
  const { valid, errors } = validateDocument(goodDoc());
  assert.equal(valid, true, errors.join('; '));
});

test('rejects bad schemaVersion, year, marks, questionType, missing fields', () => {
  const d = goodDoc();
  d.schemaVersion = '9.9';
  d.questions[0].year = 1850;
  d.questions[0].marks = 999;
  d.questions[1].questionType = 'essay';
  delete d.questions[1].questionText;
  const { valid, errors } = validateDocument(d);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('schemaVersion')));
  assert.ok(errors.some((e) => e.includes('year')));
  assert.ok(errors.some((e) => e.includes('marks')));
  assert.ok(errors.some((e) => e.includes('questionType')));
  assert.ok(errors.some((e) => e.includes('questionText')));
});

test('detects duplicate external ids within one file', () => {
  const d = goodDoc();
  d.questions[1].id = d.questions[0].id;
  const { valid, errors } = validateDocument(d);
  assert.equal(valid, false);
  assert.match(errors.join(), /duplicate id/);
});

test('dedupeKey is whitespace/case tolerant on text; ids deterministic', () => {
  const k1 = computeDedupeKey({ subjectCode: 'BCA209', year: 2024, unit: 1, questionNumber: '1(a)', questionText: 'Explain  Boolean algebra AND its laws.' });
  const k2 = computeDedupeKey({ subjectCode: 'BCA209', year: 2024, unit: 1, questionNumber: '1 (a)', questionText: 'explain boolean algebra and its laws.' });
  assert.equal(k1, k2);
  assert.equal(questionDocId(k1), questionDocId(k2));
  assert.ok(k1.length <= 100);
  assert.match(questionDocId(k1), /^q[0-9a-f]{32}$/);
});

test('fresh import auto-creates references and imports all questions', async () => {
  const dao = memDao();
  const report = await importDocument(goodDoc(), dao, { sourceFile: 'coa.json' });
  assert.deepEqual({ imported: report.imported, duplicates: report.duplicates, invalid: report.invalid }, { imported: 2, duplicates: 0, invalid: 0 });
  assert.equal(dao.state.questions.rows.length, 2);
  assert.equal(dao.state.courses.rows.length, 1);
  assert.equal(dao.state.topics.rows.length, 1);
});

test('re-importing the same file is idempotent: all duplicates', async () => {
  const dao = memDao();
  const opts = { sourceFile: 'coa.json' };
  await importDocument(goodDoc(), dao, opts);
  const second = await importDocument(goodDoc(), dao, opts);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(dao.state.questions.rows.length, 2);
});

test('upsert updates changed content instead of duplicating', async () => {
  const dao = memDao();
  await importDocument(goodDoc(), dao, {});
  const changed = goodDoc();
  changed.questions[0].questionText = 'Explain Boolean Algebra, its laws and theorems.';
  const report = await importDocument(changed, dao, { upsert: true });
  assert.equal(report.imported, 1);
  assert.equal(dao.state.questions.rows.length, 2);
});

test('dryRun imports nothing', async () => {
  const dao = memDao();
  const report = await importDocument(goodDoc(), dao, { dryRun: true });
  assert.equal(report.imported, 2);
  assert.equal(dao.state.questions.rows.length, 0);
});

test('autoCreate=false records missing references as invalid, never silent', async () => {
  const dao = memDao({ courses: [{ $id: 'c_BCA', code: 'BCA', name: 'BCA' }] });
  const report = await importDocument(goodDoc(), dao, { autoCreate: false });
  assert.equal(report.imported, 0);
  assert.equal(report.invalid, 2); // subject does not exist → whole file flagged
  assert.ok(report.errors.length > 0);
});

test('external id collision with different content is reported invalid', async () => {
  const dao = memDao();
  await importDocument(goodDoc(), dao, {});
  const d = goodDoc();
  d.questions[1].id = 'COA-2024-001'; // reuse id 1 on a different question
  d.questions[1].questionNumber = 'X';
  d.questions[0].id = 'COA-2024-009'; // keep q0 unique so it dedupes cleanly
  const report = await importDocument(d, dao, {});
  assert.equal(report.invalid, 1);
  assert.match(report.errors[0].message, /already used/);
});

test('write failures are recorded, not discarded', async () => {
  const dao = memDao();
  const orig = dao.createQuestion;
  dao.createQuestion = async (id, data) => { throw new Error('server exploded'); };
  const report = await importDocument(goodDoc(), dao, {});
  assert.equal(report.imported, 0);
  assert.equal(report.invalid, 2);
  assert.equal(report.errors.length, 2);
});
