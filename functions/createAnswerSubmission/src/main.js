import {
  makeServices, requireUser, parseBody, ok, wrap, ids, limits, HttpError,
  ID, Query, Permission, Role, getDoc, checkDocId, checkString,
} from './lib.js';

const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

async function verifyOwnedImages(svc, userId, fileIds) {
  const ordered = [];
  for (const fileId of fileIds) {
    checkDocId(fileId, 'imageFileId');
    let file;
    try {
      file = await svc.storage.getFile(ids.bucketAnswerImages, fileId);
    } catch {
      throw new HttpError(400, 'INVALID_IMAGE', `Image file "${fileId}" does not exist in the answer-images bucket.`);
    }
    if (!IMAGE_EXT_RE.test(file.nameOriginal ?? file.name ?? '') && !IMAGE_MIMES.includes(file.mimeType)) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', `File "${file.name ?? fileId}" is not a JPEG/PNG/WebP image.`);
    }
    const readable = [`read("user:${userId}")`, `read("team:${ids.adminTeamId}")`];
    const owned = (file.$permissions ?? []).some((p) => readable.includes(p));
    if (!owned) throw new HttpError(403, 'IMAGE_NOT_OWNED', `You do not own image file "${fileId}".`);
    ordered.push(file.$id);
  }
  return ordered; // array order == display order
}

async function assertRateLimit(svc, userId) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const res = await svc.databases.listDocuments(ids.databaseId, ids.answers,
    [Query.equal('userId', userId), Query.greaterThan('$createdAt', hourAgo), Query.limit(100)]);
  if (res.total >= limits.submissionsPerHour) {
    throw new HttpError(429, 'RATE_LIMITED', `Limit of ${limits.submissionsPerHour} submissions per hour reached. Try again later.`);
  }
}

export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const userId = requireUser(req);
  const body = parseBody(req);
  const action = body.action ?? 'create';

  const explanation = checkString(String(body.explanation ?? '').trim(), 'explanation', limits.maxExplanation);
  const rawImages = Array.isArray(body.imageFileIds) ? body.imageFileIds : [];
  if (rawImages.length > limits.maxAnswerImages) {
    throw new HttpError(400, 'TOO_MANY_IMAGES', `Maximum ${limits.maxAnswerImages} images per answer.`);
  }
  const imageFileIds = rawImages.length ? await verifyOwnedImages(svc, userId, rawImages) : [];

  const docPerms = [
    Permission.read(Role.user(userId)),
    Permission.read(Role.team(ids.adminTeamId)),
    Permission.update(Role.team(ids.adminTeamId)),
    Permission.delete(Role.team(ids.adminTeamId)),
  ];

  if (action === 'update') {
    const submissionId = checkDocId(body.submissionId, 'submissionId');
    const doc = await getDoc(svc, ids.answers, submissionId);
    if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Submission not found.');
    if (doc.userId !== userId) throw new HttpError(403, 'FORBIDDEN', 'You can only edit your own submissions.');
    if (!['pending', 'rejected'].includes(doc.status)) {
      throw new HttpError(409, 'NOT_EDITABLE', `Published/removed answers cannot be edited (status: ${doc.status}).`);
    }
    const updated = await svc.databases.updateDocument(ids.databaseId, ids.answers, submissionId, {
      explanation, imageFileIds, status: 'pending',
    });
    return ok(res, { submission: { $id: updated.$id, status: updated.status } });
  }

  if (action !== 'create') throw new HttpError(400, 'INVALID_ACTION', 'action must be "create" or "update".');

  const questionId = checkDocId(body.questionId, 'questionId');
  const question = await getDoc(svc, ids.questions, questionId);
  if (!question) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question does not exist.');

  await assertRateLimit(svc, userId);
  const profile = await getDoc(svc, ids.users, userId);
  if ((profile?.status ?? 'active') !== 'active') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended.');
  }
  let fallbackName = userId;
  try { fallbackName = (await svc.users.get(userId)).name || userId; } catch { /* keep id */ }
  const displayName = (profile?.displayName || fallbackName).toString().slice(0, 100);

  const doc = await svc.databases.createDocument(ids.databaseId, ids.answers, ID.unique(), {
    questionId, userId, displayName, explanation, imageFileIds, status: 'pending',
  }, docPerms);

  return ok(res, {
    submission: { $id: doc.$id, status: doc.status },
    notice: 'Your answer is pending moderation and is not public yet.',
  }, 201);
});
