import {
  makeServices, requireUser, requireAdmin, isAdmin, parseBody, ok, wrap, ids, HttpError,
  Query, getDoc, checkDocId, profilePermissions,
} from './lib.js';

const ROLES = ['student', 'admin'];
const STATUSES = ['active', 'suspended'];

export default wrap(async ({ req, res }) => {
  const svc = makeServices(req);
  const me = requireUser(req);
  const body = parseBody(req);
  const action = body.action;

  // ── self-service: create/refresh own profile. Role is ALWAYS student here. ──
  if (action === 'ensureProfile' || action === 'me') {
    let profile = await getDoc(svc, ids.users, me);
    if (!profile && action === 'ensureProfile') {
      const displayName = String(body.displayName ?? '').trim().slice(0, 100);
      if (!displayName) throw new HttpError(400, 'INVALID_INPUT', 'displayName (1-100 chars) is required.');
      profile = await svc.databases.createDocument(ids.databaseId, ids.users, me, {
        userId: me, displayName, email: String(body.email ?? '').slice(0, 100),
        role: 'student', status: 'active',
      }, profilePermissions(me));
    }
    if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'No profile yet — call ensureProfile first.');
    return ok(res, { profile: { $id: profile.$id, displayName: profile.displayName, role: profile.role, status: profile.status, isAdmin: await isAdmin(svc, me) } });
  }

  // ── everything below requires admin ──
  const adminId = await requireAdmin(svc, req);

  if (action === 'list') {
    const pageSize = Math.min(Number(body.pageSize ?? 20), 100);
    const page = Math.max(Number(body.page ?? 1), 1);
    const res_ = await svc.databases.listDocuments(ids.databaseId, ids.users,
      [Query.limit(pageSize), Query.offset((page - 1) * pageSize), Query.orderAsc('$createdAt')]);
    return ok(res, { total: res_.total, page, profiles: res_.documents.map((p) => ({
      userId: p.$id, displayName: p.displayName, email: p.email, role: p.role, status: p.status, createdAt: p.$createdAt,
    })) });
  }

  if (action === 'setRole') {
    const userId = checkDocId(body.userId, 'userId');
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'INVALID_ROLE', `role must be one of ${ROLES.join(', ')}.`);
    const profile = await getDoc(svc, ids.users, userId);
    if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Target user has no profile; ask them to sign in first.');

    if (body.role === 'admin') {
      await svc.teams.createMembership(ids.adminTeamId, ['member'], undefined, userId);
    } else {
      if (userId === adminId) {
        const memberships = await svc.teams.listMemberships(ids.adminTeamId, [Query.limit(100)]);
        if (memberships.total <= 1) throw new HttpError(409, 'LAST_ADMIN', 'You are the last admin; promote another admin before demoting yourself.');
      }
      const ms = await svc.teams.listMemberships(ids.adminTeamId, [Query.equal('userId', [userId])]);
      for (const m of ms.memberships) await svc.teams.deleteMembership(ids.adminTeamId, m.$id);
    }
    const updated = await svc.databases.updateDocument(ids.databaseId, ids.users, userId, { role: body.role });
    return ok(res, { profile: { $id: updated.$id, role: updated.role } });
  }

  if (action === 'setStatus') {
    const userId = checkDocId(body.userId, 'userId');
    if (!STATUSES.includes(body.status)) throw new HttpError(400, 'INVALID_STATUS', `status must be one of ${STATUSES.join(', ')}.`);
    if (userId === adminId) throw new HttpError(409, 'SELF_SUSPEND', 'Admins cannot suspend themselves.');
    const profile = await getDoc(svc, ids.users, userId);
    if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Target user has no profile.');
    await svc.users.updateStatus(userId, body.status === 'active');
    const updated = await svc.databases.updateDocument(ids.databaseId, ids.users, userId, { status: body.status });
    return ok(res, { profile: { $id: updated.$id, status: updated.status } });
  }

  throw new HttpError(400, 'INVALID_ACTION', 'action must be one of: ensureProfile, me, list, setRole, setStatus.');
});
