import { Client, Databases, Storage, Functions, Teams, Users, Permission, Role, ID, Query } from 'node-appwrite';
import { config, assertConfig } from './config.js';

export function makeClients() {
  assertConfig();
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);
  return {
    client,
    databases: new Databases(client),
    storage: new Storage(client),
    functions: new Functions(client),
    teams: new Teams(client),
    users: new Users(client),
  };
}

export const S = Permission.read(Role.any());
export const ADMIN_R = Permission.read(Role.team(config.adminTeamId));

/** Run a create call, treating "already exists" (409/400 duplicate) as OK. */
export async function ensure(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    return true;
  } catch (err) {
    const msg = String(err?.message || '');
    if (err?.code === 409 || /duplicate|already exists/i.test(msg)) {
      console.log(`  = ${label} (already exists)`);
      return false;
    }
    console.error(`  ✗ ${label}: ${err?.code ?? ''} ${msg}`);
    throw err;
  }
}

export { Permission, Role, ID, Query, config };
