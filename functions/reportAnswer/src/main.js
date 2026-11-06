import {
  makeServices, requireUser, parseBody, ok, wrap, ids, limits, HttpError,
  ID, Query, Permission, Role, getDoc, checkDocId, checkString,
} from './lib.js';

const REASONS = ['inappropriate', 'wrong_answer', 'plagiarism', 'spam', 'other'];

export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const userId = requireUser(req);
  const body = parseBody(req);
  const submissionId = checkDocId(body.submissionId, 'submissionId');
  const reason = checkString(String(body.reason ?? ''), 'reason', 50);
  if (!REASONS.includes(reason)) throw new HttpError(400, 'INVALID_REASON', `reason must be one of: ${REASONS.join(', ')}.`);
  const description = String(body.description ?? '').trim().slice(0, 2000);

  const submission = await getDoc(svc, ids.answers, submissionId);
  if (!submission) throw new HttpError(404, 'NOT_FOUND', 'Submission not found.');

  const dup = await svc.databases.listDocuments(ids.databaseId, ids.reports,
    [Query.equal('submissionId', submissionId), Query.equal('reporterId', userId), Query.limit(1)]);
  if (dup.total > 0) throw new HttpError(409, 'ALREADY_REPORTED', 'You already reported this answer.');

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = await svc.databases.listDocuments(ids.databaseId, ids.reports,
    [Query.equal('reporterId', userId), Query.greaterThan('$createdAt', dayAgo), Query.limit(100)]);
  if (recent.total >= limits.reportsPerDay) {
    throw new HttpError(429, 'RATE_LIMITED', `Daily report limit (${limits.reportsPerDay}) reached.`);
  }

  const doc = await svc.databases.createDocument(ids.databaseId, ids.reports, ID.unique(), {
    submissionId, reporterId: userId, reason, description, status: 'pending',
  }, [
    Permission.read(Role.user(userId)),
    Permission.read(Role.team(ids.adminTeamId)),
    Permission.update(Role.team(ids.adminTeamId)),
    Permission.delete(Role.team(ids.adminTeamId)),
  ]);

  return ok(res, { report: { $id: doc.$id, status: doc.status } }, 201);
});
