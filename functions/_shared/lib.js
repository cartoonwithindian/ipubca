// Shared runtime library for all ipubca Appwrite Functions.
// Copied into each function's src/ by scripts/deploy-functions.js before zipping.
import { Client, Databases, Storage, Teams, Users, Permission, Role, ID, Query } from 'node-appwrite';

export { Permission, Role, ID, Query };

const env = (k, d) => process.env[k] || d;

export const ids = {
  databaseId: env('DB_ID', 'pyq_platform'),
  users: env('COL_USERS', 'users'),
  courses: env('COL_COURSES', 'courses'),
  semesters: env('COL_SEMESTERS', 'semesters'),
  subjects: env('COL_SUBJECTS', 'subjects'),
  units: env('COL_UNITS', 'units'),
  topics: env('COL_TOPICS', 'topics'),
  questions: env('COL_QUESTIONS', 'questions'),
  answers: env('COL_ANSWERS', 'answerSubmissions'),
  reports: env('COL_REPORTS', 'reports'),
  imports: env('COL_IMPORTS', 'importJobs'),
  bucketAnswerImages: env('BUCKET_ANSWER_IMAGES', 'answer_images'),
  bucketPyqImports: env('BUCKET_PYQ_IMPORTS', 'pyq_imports'),
  adminTeamId: env('ADMIN_TEAM_ID', 'pyqadmins'),
};

export const limits = {
  maxAnswerImages: Number(env('LIMIT_MAX_IMAGES', 10)),
  maxExplanation: Number(env('LIMIT_MAX_EXPLANATION', 50000)),
  submissionsPerHour: Number(env('LIMIT_SUBMISSIONS_PER_HOUR', 20)),
  reportsPerDay: Number(env('LIMIT_REPORTS_PER_DAY', 30)),
  orphanAgeHours: Number(env('LIMIT_ORPHAN_AGE_HOURS', 24)),
};

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function makeServices(req) {
  const client = new Client()
    .setEndpoint(env('APPWRITE_FUNCTION_API_ENDPOINT', process.env.APPWRITE_FUNCTION_ENDPOINT))
    .setProject(env('APPWRITE_FUNCTION_PROJECT_ID'))
    .setKey(req.headers['x-appwrite-key'] ?? '');
  return {
    client,
    databases: new Databases(client),
    storage: new Storage(client),
    teams: new Teams(client),
    users: new Users(client),
  };
}

export function callerId(req) {
  return req.headers['x-appwrite-user-id'] || '';
}

export function requireUser(req) {
  const id = callerId(req);
  if (!id) throw new HttpError(401, 'UNAUTHENTICATED', 'A logged-in session is required.');
  return id;
}

let adminCache = null;
export async function isAdmin(svc, userId) {
  if (!userId) return false;
  if (!adminCache) {
    adminCache = new Set();
    for (let page = 1; page <= 10; page++) {
      const res = await svc.teams.listMemberships(ids.adminTeamId, [Query.limit(100), Query.offset((page - 1) * 100)]);
      for (const m of res.memberships) adminCache.add(m.userId);
      if (res.memberships.length < 100) break;
    }
  }
  return adminCache.has(userId);
}

export async function requireAdmin(svc, req) {
  const userId = requireUser(req);
  if (!(await isAdmin(svc, userId))) throw new HttpError(403, 'FORBIDDEN', 'Admin access required.');
  return userId;
}

export function parseBody(req) {
  try {
    return req._body ? JSON.parse(req.body ?? '{}') : {};
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

// ── validation helpers ──────────────────────────────────────────────
export const DOC_ID_RE = /^[a-z0-9][a-z0-9_-]{0,35}$/i;
export function checkDocId(v, field) {
  if (typeof v !== 'string' || !DOC_ID_RE.test(v)) throw new HttpError(400, 'INVALID_INPUT', `${field} must be a valid document id.`);
  return v;
}
export function checkString(v, field, max) {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a string of 1-${max} characters.`);
  }
  return v;
}

// ── response helpers (unified envelope) ────────────────────────────
export function ok(res, data, status = 200) {
  return res.json({ ok: true, ...data }, status);
}

export function wrap(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const code = err instanceof HttpError ? err.code : 'INTERNAL';
      const message = err instanceof HttpError ? err.message : 'Unexpected server error.';
      context.error?.(String(err?.stack ?? err));
      return context.res.json({ ok: false, error: { code, message, httpStatus: status } }, status);
    }
  };
}

// ── document helpers ────────────────────────────────────────────────
export async function getDoc(svc, collection, id) {
  try {
    return await svc.databases.getDocument(ids.databaseId, collection, id);
  } catch {
    return null;
  }
}

export function profilePermissions(userId) {
  return [
    Permission.read(Role.user(userId)),
    Permission.read(Role.team(ids.adminTeamId)),
    Permission.update(Role.team(ids.adminTeamId)),
    Permission.delete(Role.team(ids.adminTeamId)),
  ];
}
