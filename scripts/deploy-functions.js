#!/usr/bin/env node
// Creates/updates all 8 Appwrite Functions and deploys their code (zipped).
// Idempotent: existing functions are updated, code is redeployed & activated.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Permission, Role, InputFile } from 'node-appwrite';
import { makeClients, ensure, config } from './lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { client, functions } = makeClients();
const adminTeam = Role.team(config.adminTeamId);
const buildDir = resolve(root, 'functions/.build');
mkdirSync(buildDir, { recursive: true });

const env = {
  DB_ID: config.databaseId,
  COL_USERS: config.collections.users,
  COL_COURSES: config.collections.courses,
  COL_SEMESTERS: config.collections.semesters,
  COL_SUBJECTS: config.collections.subjects,
  COL_UNITS: config.collections.units,
  COL_TOPICS: config.collections.topics,
  COL_QUESTIONS: config.collections.questions,
  COL_ANSWERS: config.collections.answers,
  COL_REPORTS: config.collections.reports,
  COL_IMPORTS: config.collections.imports,
  BUCKET_ANSWER_IMAGES: config.buckets.answerImages,
  BUCKET_PYQ_IMPORTS: config.buckets.pyqImports,
  ADMIN_TEAM_ID: config.adminTeamId,
  LIMIT_MAX_IMAGES: String(config.limits.maxAnswerImages),
  LIMIT_MAX_EXPLANATION: String(config.limits.maxExplainLength),
  LIMIT_SUBMISSIONS_PER_HOUR: String(config.limits.submissionsPerHour),
  LIMIT_REPORTS_PER_DAY: String(config.limits.reportsPerDayPerUser),
  LIMIT_ORPHAN_AGE_HOURS: String(config.limits.orphanFileAgeHours),
};

const USERS_EXECUTE = [Permission.execute(Role.users())];
const ADMIN_EXECUTE = [Permission.execute(adminTeam)];
const COMMON_SCOPES = ['documents', 'storage', 'users', 'teams', 'functions'];

const SPECS = [
  { id: config.functions.importPyqJson, dir: 'importPyqJson', name: 'Import PYQ JSON', execute: ADMIN_EXECUTE, timeout: 300 },
  { id: config.functions.createAnswerSubmission, dir: 'createAnswerSubmission', name: 'Create/Update Answer', execute: USERS_EXECUTE, timeout: 60 },
  { id: config.functions.publishAnswer, dir: 'publishAnswer', name: 'Publish Answer', execute: ADMIN_EXECUTE, timeout: 60 },
  { id: config.functions.rejectAnswer, dir: 'rejectAnswer', name: 'Reject Answer', execute: ADMIN_EXECUTE, timeout: 60 },
  { id: config.functions.deleteAnswer, dir: 'deleteAnswer', name: 'Delete Answer', execute: USERS_EXECUTE, timeout: 60 },
  { id: config.functions.reportAnswer, dir: 'reportAnswer', name: 'Report Answer', execute: USERS_EXECUTE, timeout: 30 },
  { id: config.functions.adminUserManagement, dir: 'adminUserManagement', name: 'Admin User Management', execute: USERS_EXECUTE, timeout: 60 },
  { id: config.functions.cleanupOrphanedFiles, dir: 'cleanupOrphanedFiles', name: 'Cleanup Orphaned Files', execute: ADMIN_EXECUTE, timeout: 300, schedule: '0 0 * * *' },
];

for (const spec of SPECS) {
  const fnDir = resolve(root, 'functions', spec.dir);
  // bundle shared lib into the function
  cpSync(resolve(root, 'functions/_shared/lib.js'), resolve(fnDir, 'src/lib.js'));

  const existing = await functions.get(spec.id).catch(() => null);
  const params = {
    functionId: spec.id, name: spec.name, runtime: 'node-22',
    execute: spec.execute, events: [], schedule: spec.schedule ?? '',
    timeout: spec.timeout, enabled: true, logging: true,
    entrypoint: 'src/main.js', commands: 'npm install', scopes: COMMON_SCOPES, env,
  };
  if (!existing) {
    await ensure(`function ${spec.id}`, () => client.call('POST', '/functions', new Headers({ 'content-type': 'application/json' }), params));
  } else {
    await ensure(`function ${spec.id} (update)`, () => client.call('PATCH', `/functions/${spec.id}`, new Headers({ 'content-type': 'application/json' }), params));
  }

  const zip = resolve(buildDir, `${spec.id}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-r', zip, '.', '-x', 'node_modules/*', '-x', '.build/*'], { cwd: fnDir, stdio: 'pipe' });
  process.stdout.write(`  deploying ${spec.id} ...`);
  await functions.createDeployment(spec.id, InputFile.fromPath(zip, `${spec.id}.zip`), true);
  console.log(' ✓ activated');
}

console.log('\nAll functions deployed.');
