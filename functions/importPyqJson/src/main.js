import { createHash } from 'node:crypto';
import { makeServices, requireAdmin, parseBody, ok, wrap, ids, HttpError, ID, Query } from './lib.js';
import { validateDocument, importDocument, questionDocId } from './engine.js';

const sha = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);
const db = ids.databaseId;

function makeDao(svc) {
  const d = svc.databases;
  const findOne = async (collection, queries) => {
    const res = await d.listDocuments(db, collection, [...queries, Query.limit(1)]);
    return res.documents[0] ?? null;
  };
  const create = async (collection, id, data) => d.createDocument(db, collection, id, data);
  return {
    findCourseByCode: (code) => findOne(ids.courses, [Query.equal('code', [code.toUpperCase()])]),
    createCourse: ({ name, code }) => create(ids.courses, `c_${sha(code.toUpperCase(), 16)}`, {
      name: name.trim(), code: code.toUpperCase(), description: '', isActive: true,
    }),
    findSemester: (courseId, number) => findOne(ids.semesters, [Query.equal('courseId', courseId), Query.equal('semesterNumber', number)]),
    createSemester: (courseId, number) => create(ids.semesters, `s_${sha(courseId + number, 16)}`, {
      courseId, semesterNumber: number, name: `Semester ${number}`, isActive: true,
    }),
    findSubject: (semesterId, code) => findOne(ids.subjects, [Query.equal('semesterId', semesterId), Query.equal('subjectCode', code.toUpperCase())]),
    createSubject: (courseId, semesterId, { name, code }) => create(ids.subjects, `sub_${sha(semesterId + code.toUpperCase(), 16)}`, {
      courseId, semesterId, subjectName: name.trim(), subjectCode: code.toUpperCase(),
      description: '', syllabus: '', isActive: true,
    }),
    findUnit: (subjectId, number) => findOne(ids.units, [Query.equal('subjectId', subjectId), Query.equal('unitNumber', number)]),
    createUnit: (subjectId, number) => create(ids.units, `u_${sha(subjectId + number, 16)}`, {
      subjectId, unitNumber: number, title: `Unit ${number}`, description: '',
    }),
    findTopic: (unitId, title) => findOne(ids.topics, [Query.equal('unitId', unitId), Query.equal('title', title.trim().toLowerCase())]),
    createTopic: (unitId, title) => create(ids.topics, `t_${sha(unitId + title.trim().toLowerCase(), 16)}`, {
      unitId, title: title.trim(), description: '',
    }),
    findQuestionByDedupe: (key) => findOne(ids.questions, [Query.equal('dedupeKey', [key])]),
    findQuestionByExternalId: (subjectId, externalId) => findOne(ids.questions, [Query.equal('subjectId', subjectId), Query.equal('externalId', [externalId])]),
    createQuestion: (id, data) => create(ids.questions, id, data),
    updateQuestion: (id, data) => d.updateDocument(db, ids.questions, id, data),
  };
}

async function readJsonFiles(svc, fileIds) {
  const out = [];
  for (const fileId of fileIds) {
    let fileName = fileId;
    try {
      const meta = await svc.storage.getFile(ids.bucketPyqImports, fileId);
      fileName = meta.name || fileId;
      if (!/\.json$/i.test(fileName)) throw new HttpError(400, 'FILE_TYPE', `File ${fileName} is not a .json upload.`);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(404, 'FILE_NOT_FOUND', `Storage file "${fileId}" not found in pyq-imports bucket.`);
    }
    let text;
    try {
      const buf = await svc.storage.getFileDownload(ids.bucketPyqImports, fileId);
      text = Buffer.from(buf).toString('utf8');
    } catch {
      throw new HttpError(400, 'FILE_UNREADABLE', `Could not download ${fileName}. Re-upload it to the pyq_imports bucket.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      out.push({ fileName, parseError: `Invalid JSON syntax: ${err.message}` });
      continue;
    }
    out.push({ fileName, parsed });
  }
  return out;
}

async function recordJob(svc, { fileName, importedBy, status, report }) {
  return svc.databases.createDocument(db, ids.imports, ID.unique(), {
    fileName, importedBy,
    totalQuestions: report.totalQuestions ?? 0,
    successfulQuestions: report.imported ?? 0,
    failedQuestions: (report.invalid ?? 0) + (report.errors?.filter((e) => e.writeError).length ?? 0),
    skippedQuestions: 0,
    duplicateQuestions: report.duplicates ?? 0,
    status,
    report: JSON.stringify(report),
  }, perms);
}

export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const adminId = await requireAdmin(svc, req);
  const body = parseBody(req);
  const options = body.options ?? {};

  const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
  const inline = Array.isArray(body.documents) ? body.documents : [];
  if (!fileIds.length && !inline.length) {
    throw new HttpError(400, 'INVALID_INPUT', 'Provide fileIds (uploaded to pyq_imports bucket) and/or documents (inline JSON).');
  }

  const dao = makeDao(svc);
  const files = await readJsonFiles(svc, fileIds);
  const jobs = [];

  for (const item of [...files, ...inline.map((parsed, i) => ({ fileName: `inline-${i + 1}.json`, parsed }))]) {
    const { fileName } = item;
    if (item.parseError) {
      jobs.push(await recordJob(svc, { fileName, importedBy: adminId, status: 'failed',
        report: { fileName, totalQuestions: 0, imported: 0, duplicates: 0, invalid: 0, errors: [{ message: item.parseError }] } }));
      continue;
    }
    const { valid, errors } = validateDocument(item.parsed);
    if (!valid) {
      jobs.push(await recordJob(svc, { fileName, importedBy: adminId, status: 'failed',
        report: { fileName, totalQuestions: item.parsed?.questions?.length ?? 0, imported: 0, duplicates: 0,
          invalid: item.parsed?.questions?.length ?? errors.length, errors: errors.map((m) => ({ message: m })) } }));
      continue;
    }
    const report = await importDocument(item.parsed, dao, { ...options, sourceFile: fileName });
    const status = report.imported > 0 ? (report.invalid > 0 ? 'completed_with_errors' : 'completed')
      : (report.duplicates > 0 ? 'completed_duplicates_only' : 'failed');
    jobs.push(await recordJob(svc, { fileName, importedBy: adminId, status, report }));
  }

  return ok(res, {
    summary: {
      filesProcessed: jobs.length,
      imported: jobs.reduce((n, j) => n + j.successfulQuestions, 0),
      duplicates: jobs.reduce((n, j) => n + j.duplicateQuestions, 0),
      invalid: jobs.reduce((n, j) => n + j.failedQuestions, 0),
    },
    jobs: jobs.map((j) => ({ jobId: j.$id, fileName: j.fileName, status: j.status })),
    reports: jobs.map((j) => JSON.parse(j.report)),
  });
});
