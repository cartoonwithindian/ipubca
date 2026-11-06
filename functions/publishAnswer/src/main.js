import {
  makeServices, requireAdmin, parseBody, ok, wrap, ids, HttpError,
  Permission, Role, getDoc, checkDocId,
} from './lib.js';

export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const adminId = await requireAdmin(svc, req);
  const body = parseBody(req);
  const submissionId = checkDocId(body.submissionId, 'submissionId');

  const doc = await getDoc(svc, ids.answers, submissionId);
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Submission not found.');
  if (doc.status === 'published') return ok(res, { submission: { $id: submissionId, status: 'published' }, notice: 'Already published.' });
  if (doc.status === 'removed') throw new HttpError(409, 'REMOVED', 'Removed submissions cannot be published.');

  await svc.databases.updateDocument(ids.databaseId, ids.answers, submissionId, {
    status: 'published', moderatedBy: adminId, moderationNote: String(body.note ?? '').slice(0, 2000),
  });

  // Flip document + every image to public read. Document write perms stay admin-only.
  const newPerms = [
    Permission.read(Role.any()),
    Permission.read(Role.user(doc.userId)),
    Permission.read(Role.team(ids.adminTeamId)),
    Permission.update(Role.team(ids.adminTeamId)),
    Permission.delete(Role.team(ids.adminTeamId)),
  ];
  await svc.databases.updateDocument(ids.databaseId, ids.answers, submissionId, {}, newPerms);

  for (const fileId of doc.imageFileIds ?? []) {
    try {
      const file = await svc.storage.getFile(ids.bucketAnswerImages, fileId);
      const perms = [...new Set([...(file.$permissions ?? []), Permission.read(Role.any())])];
      await svc.storage.updateFile(ids.bucketAnswerImages, fileId, file.name, perms);
    } catch { /* missing file: cleanupOrphanedFiles will handle it */ }
  }

  return ok(res, { submission: { $id: submissionId, status: 'published', images: (doc.imageFileIds ?? []).length } });
});
