import {
  makeServices, requireUser, isAdmin, parseBody, ok, wrap, ids, HttpError,
  getDoc, checkDocId,
} from './lib.js';

export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const userId = requireUser(req);
  const admin = await isAdmin(svc, userId);
  const body = parseBody(req);
  const submissionId = checkDocId(body.submissionId, 'submissionId');

  const doc = await getDoc(svc, ids.answers, submissionId);
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Submission not found.');

  const isOwner = doc.userId === userId;
  if (!isOwner && !admin) throw new HttpError(403, 'FORBIDDEN', 'You can only delete your own submissions.');
  if (isOwner && !admin && doc.status === 'published') {
    throw new HttpError(403, 'PUBLISHED_DELETE', 'Published answers cannot be deleted by their author. Report it or contact an admin instead.');
  }

  for (const fileId of doc.imageFileIds ?? []) {
    try { await svc.storage.deleteFile(ids.bucketAnswerImages, fileId); } catch { /* already gone */ }
  }
  await svc.databases.deleteDocument(ids.databaseId, ids.answers, submissionId);

  return ok(res, { deleted: true, submissionId, imagesRemoved: (doc.imageFileIds ?? []).length });
});
