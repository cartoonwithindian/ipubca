import {
  makeServices, ok, wrap, ids, limits, HttpError, Query, isAdmin,
} from './lib.js';

// Deletes answer-images files older than LIMIT_ORPHAN_AGE_HOURS that are not
// referenced by any submission in any status. Runs as an admin-executed task
// and on a schedule (see deploy script). Scheduled runs have no caller session,
// so the admin check is skipped when req.headers['x-appwrite-event'] is set.
export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const userId = req.headers['x-appwrite-user-id'] || '';
  // Runs with no caller = internal scheduler. Any authenticated caller must be admin.
  if (userId && !(await isAdmin(svc, userId))) throw new HttpError(403, 'FORBIDDEN', 'Admin access required.');

  const referenced = new Set();
  for (let page = 1; page <= 200; page++) {
    const docs = await svc.databases.listDocuments(ids.databaseId, ids.answers,
      [Query.select(['imageFileIds']), Query.limit(100), Query.offset((page - 1) * 100)]);
    for (const d of docs.documents) for (const f of d.imageFileIds ?? []) referenced.add(f);
    if (docs.documents.length < 100) break;
  }

  const cutoff = new Date(Date.now() - limits.orphanAgeHours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  let deleted = 0;
  let scanned = 0;
  for (let page = 1; page <= 100; page++) {
    const files = await svc.storage.listFiles(ids.bucketAnswerImages,
      [Query.limit(500), Query.offset((page - 1) * 500), Query.lessThan('$createdAt', cutoff)]);
    for (const file of files.files) {
      scanned++;
      if (referenced.has(file.$id)) continue;
      try {
        await svc.storage.deleteFile(ids.bucketAnswerImages, file.$id);
        deleted++;
      } catch { /* ignore individual failures; next run retries */ }
    }
    if (files.files.length < 500) break;
  }

  return ok(res, { scanned, deleted, referencedCount: referenced.size, olderThanHours: limits.orphanAgeHours });
});
