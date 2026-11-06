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
  if (doc.status === 'removed') throw new HttpError(409, 'REMOVED', 'Submission was already removed.');

  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new HttpError(400, 'INVALID_INPUT', 'A rejection reason is required.');

  await svc.databases.updateDocument(ids.databaseId, ids.answers, submissionId, {
    status: 'rejected', moderatedBy: adminId, moderationNote: reason.slice(0, 2000),
  });

  // Un-publish: strip guest + owner read, keep admin-only access.
  const ownerPerms = [
    Permission.read(Role.user(doc.userId)),
    Permission.read(Role.team(ids.adminTeamId)),
    Permission.update(Role.team(ids.adminTeamId)),
    Permission.delete(Role.team(ids.adminTeamId)),
  ];
  await svc.databases.updateDocument(ids.databaseId, ids.answers, submissionId, {}, ownerPerms);
  for (const fileId of doc.imageFileIds ?? []) {
    try {
      const file = await svc.storage.getFile(ids.bucketAnswerImages, fileId);
      const perms = (file.$permissions ?? []).filter((p) => !/^read\("guests"\)|read\("any"\)/.test(p));
      await svc.storage.updateFile(ids.bucketAnswerImages, fileId, file.name, perms);
    } catch { /* ignore missing files */ }
  }

  return ok(res, { submission: { $id: submissionId, status: 'rejected' } });
});
