// PYQ JSON import engine. Pure logic against a DAO interface — no Appwrite
// imports here so it can be unit-tested (tests/import-engine.test.js).
import { createHash } from 'node:crypto';

export const SUPPORTED_SCHEMA_VERSIONS = ['1.0'];
export const QUESTION_TYPES = ['very_short', 'short', 'mcq', 'long'];
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,14}$/;

function fail(errors, msg) { errors.push(msg); }
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const nowYear = () => new Date().getUTCFullYear();

/** Validate one parsed PYQ document. Returns { valid, errors }. */
export function validateDocument(parsed) {
  const errors = [];
  if (!isObj(parsed)) return { valid: false, errors: ['File root must be a JSON object.'] };

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(String(parsed.schemaVersion))) {
    fail(errors, `Unsupported schemaVersion "${parsed.schemaVersion}". Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (!isObj(parsed.course) || typeof parsed.course.code !== 'string' || !CODE_RE.test(parsed.course.code)) {
    fail(errors, 'course.code must be a string matching /^[A-Za-z0-9][A-Za-z0-9._-]{1,14}$/.');
  } else if (typeof parsed.course.name !== 'string' || !parsed.course.name.trim()) {
    fail(errors, 'course.name must be a non-empty string.');
  }
  if (!isInt(parsed.semester) || parsed.semester < 1 || parsed.semester > 12) {
    fail(errors, 'semester must be an integer 1-12.');
  }
  if (!isObj(parsed.subject) || typeof parsed.subject.code !== 'string' || !CODE_RE.test(parsed.subject.code)) {
    fail(errors, 'subject.code must be a string matching /^[A-Za-z0-9][A-Za-z0-9._-]{1,14}$/.');
  } else if (typeof parsed.subject.name !== 'string' || !parsed.subject.name.trim()) {
    fail(errors, 'subject.name must be a non-empty string.');
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    fail(errors, 'questions must be a non-empty array.');
    return { valid: false, errors };
  }
  if (parsed.questions.length > 5000) fail(errors, 'questions exceeds the 5000-record per-file limit.');

  const seenIds = new Set();
  parsed.questions.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (!isObj(q)) { fail(errors, `${at}: must be an object.`); return; }
    if (typeof q.id !== 'string' || !q.id.trim() || q.id.length > 100) fail(errors, `${at}.id: required string 1-100 chars.`);
    else if (seenIds.has(q.id)) fail(errors, `${at}.id: duplicate id "${q.id}" within this file.`);
    else seenIds.add(q.id);
    if (!isInt(q.year) || q.year < 1980 || q.year > nowYear() + 5) fail(errors, `${at}.year: integer 1980-${nowYear() + 5}.`);
    if (!isInt(q.unit) || q.unit < 1 || q.unit > 12) fail(errors, `${at}.unit: integer 1-12.`);
    if (typeof q.questionNumber !== 'string' || !q.questionNumber.trim() || q.questionNumber.length > 50) fail(errors, `${at}.questionNumber: required string 1-50 chars.`);
    if (typeof q.questionText !== 'string' || !q.questionText.trim() || q.questionText.length > 20000) fail(errors, `${at}.questionText: required string 1-20000 chars.`);
    if (!QUESTION_TYPES.includes(q.questionType)) fail(errors, `${at}.questionType: must be one of ${QUESTION_TYPES.join(', ')}.`);
    if (!isInt(q.marks) || q.marks < 0 || q.marks > 100) fail(errors, `${at}.marks: integer 0-100.`);
    if (q.topic !== undefined && typeof q.topic !== 'string') fail(errors, `${at}.topic: must be a string when present.`);
    if (q.metadata !== undefined && !isObj(q.metadata)) fail(errors, `${at}.metadata: must be an object when present.`);
  });

  return { valid: errors.length === 0, errors };
}

const normalizeText = (s) => s.trim().replace(/\s+/g, ' ');
const sha = (s) => createHash('sha1').update(s).digest('hex');

/** Deterministic duplicate key: subject|year|unit|questionNumber|textHash. */
export function computeDedupeKey({ subjectCode, year, unit, questionNumber, questionText }) {
  const parts = [
    subjectCode.toUpperCase(),
    String(year),
    String(unit),
    normalizeText(questionNumber).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
    sha(normalizeText(questionText).toLowerCase()).slice(0, 16),
  ];
  return parts.join('|').slice(0, 100);
}

/** Deterministic, collision-safe document id for a question. */
export function questionDocId(dedupeKey) {
  return `q${sha(dedupeKey).slice(0, 32)}`;
}

function sameContent(a, b) {
  return a.questionText === b.questionText
    && a.questionType === b.questionType
    && a.marks === b.marks
    && a.questionNumber === b.questionNumber
    && a.topicId === b.topicId;
}

/**
 * Import one validated document.
 * dao must implement:
 *   findCourseByCode / createCourse
 *   findSemester(courseId, number) / createSemester
 *   findSubject(semesterId, code) / createSubject
 *   findUnit(subjectId, number) / createUnit
 *   findTopic(unitId, title) / createTopic
 *   findQuestionByDedupe(key) / findQuestionByExternalId(subjectId, externalId)
 *   createQuestion(id, data) / updateQuestion(id, data)
 */
export async function importDocument(parsed, dao, options = {}) {
  const { autoCreate = true, upsert = false, dryRun = false, sourceFile = '' } = options;
  const report = {
    fileName: sourceFile,
    totalQuestions: parsed.questions.length,
    imported: 0, duplicates: 0, skipped: 0, invalid: 0,
    errors: [],
  };

  const ref = {
    course: await dao.findCourseByCode(parsed.course.code),
    semester: null, subject: null,
  };
  if (!ref.course) {
    if (!autoCreate) { report.invalid = report.totalQuestions; report.errors.push({ file: sourceFile, message: `Course "${parsed.course.code}" not found and autoCreate is off.` }); return report; }
    ref.course = await dao.createCourse(parsed.course);
  }
  ref.semester = await dao.findSemester(ref.course.$id, parsed.semester);
  if (!ref.semester) {
    if (!autoCreate) { report.invalid = report.totalQuestions; report.errors.push({ file: sourceFile, message: `Semester ${parsed.semester} not found for course ${parsed.course.code} and autoCreate is off.` }); return report; }
    ref.semester = await dao.createSemester(ref.course.$id, parsed.semester);
  }
  ref.subject = await dao.findSubject(ref.semester.$id, parsed.subject.code);
  if (!ref.subject) {
    if (!autoCreate) { report.invalid = report.totalQuestions; report.errors.push({ file: sourceFile, message: `Subject "${parsed.subject.code}" not found and autoCreate is off.` }); return report; }
    ref.subject = await dao.createSubject(ref.course.$id, ref.semester.$id, parsed.subject);
  }

  const unitCache = new Map();
  const topicCache = new Map();
  const resolveUnit = async (n) => {
    if (unitCache.has(n)) return unitCache.get(n);
    let u = await dao.findUnit(ref.subject.$id, n);
    if (!u) {
      if (!autoCreate) { report.errors.push({ file: sourceFile, message: `Unit ${n} missing for subject ${parsed.subject.code}; autoCreate is off.` }); return null; }
      u = await dao.createUnit(ref.subject.$id, n);
    }
    unitCache.set(n, u);
    return u;
  };
  const resolveTopic = async (unit, title) => {
    if (!title) return null;
    const key = `${unit.$id}::${title}`;
    if (topicCache.has(key)) return topicCache.get(key);
    let t = await dao.findTopic(unit.$id, title);
    if (!t) {
      if (!autoCreate) return null;
      t = await dao.createTopic(unit.$id, title);
    }
    topicCache.set(key, t);
    return t;
  };

  for (const q of parsed.questions) {
    const unit = await resolveUnit(q.unit);
    if (!unit) { report.invalid++; report.errors.push({ file: sourceFile, id: q.id, message: `Unit ${q.unit} not found for subject ${parsed.subject.code}.` }); continue; }

    const data = {
      courseId: ref.course.$id,
      semesterId: ref.semester.$id,
      subjectId: ref.subject.$id,
      unitId: unit.$id,
      questionText: normalizeText(q.questionText),
      questionType: q.questionType,
      year: q.year,
      marks: q.marks,
      questionNumber: q.questionNumber.trim(),
      externalId: q.id.trim(),
      sourceFile,
      metadata: q.metadata ? JSON.stringify(q.metadata) : '',
    };
    data.dedupeKey = computeDedupeKey({ subjectCode: parsed.subject.code, ...q });
    const topic = await resolveTopic(unit, q.topic);
    data.topicId = topic ? topic.$id : '';

    try {
      const existing = await dao.findQuestionByDedupe(data.dedupeKey);
      if (existing) {
        if (upsert && !sameContent(existing, data)) {
          if (!dryRun) await dao.updateQuestion(existing.$id, data);
          report.imported++; // updated in place counts as (re)imported
        } else {
          report.duplicates++;
        }
        continue;
      }
      const idClash = await dao.findQuestionByExternalId(data.subjectId, data.externalId);
      if (idClash && idClash.$id !== questionDocId(data.dedupeKey)) {
        if (upsert) {
          if (!dryRun) await dao.updateQuestion(idClash.$id, data);
          report.imported++;
        } else {
          report.invalid++;
          report.errors.push({ file: sourceFile, id: data.externalId, message: `Question id "${data.externalId}" already used in this subject with different content. Change the JSON id or enable upsert.` });
        }
        continue;
      }
      if (!dryRun) await dao.createQuestion(questionDocId(data.dedupeKey), data);
      report.imported++;
    } catch (err) {
      if (/ID_EXISTS|duplicate|already/i.test(String(err?.message))) report.duplicates++;
      else { report.invalid++; report.errors.push({ file: sourceFile, id: q.id, message: `Write failed: ${err?.message ?? err}` }); }
    }
  }
  return report;
}
