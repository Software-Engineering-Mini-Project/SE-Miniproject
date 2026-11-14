// Personal invitation links (issue #78): an Admin invites one email address; the link works once,
// only for that address, for seven days, and not after it is revoked. All checks are server-side.
// Registration allows five attempts per IP per ten minutes, so each test stays under that.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Invitation, User } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';

const logRecords = [];
const app = createApp({ jwtSecret: 'invitation-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: (record) => logRecords.push(record) });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);
const PASSWORD = 'Password123!';

let database;
const tokens = {};

async function signIn(email) {
  const response = await api().post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(response.status, 200, response.text);
  return response.body.token;
}

const invite = (email, who = 'admin') => api().post('/api/organisation/invitations').set(auth(tokens[who])).send({ email });
const register = (email, inviteToken, extra = {}) => api().post('/api/auth/register').send({ name: 'Invited Person', email, password: PASSWORD, inviteToken, ...extra });
const lookUp = (token) => api().get(`/api/auth/invitations/${token}`);

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  logRecords.length = 0;
  for (const who of ['admin', 'lead', 'member', 'viewer']) tokens[who] = await signIn(`${who}@example.test`);
  tokens.northwind = await signIn('northwind-admin@example.test');
});
after(async () => { await database?.stop(); });

test('an invitation link joins its own email address once, as a Member, and is stored only as a hash', async () => {
  const created = await invite('New.Person@example.test');
  assert.equal(created.status, 201, created.text);
  const { token, path } = created.body;
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(path, `/register?invite=${token}`);
  assert.equal(created.body.state, 'pending');
  assert.equal(created.body.createdBy.name, 'Synthetic Admin');
  const days = (new Date(created.body.expiresAt) - new Date(created.body.createdAt)) / 86_400_000;
  assert.equal(Math.round(days), 7);
  const stored = await Invitation.findById(created.body.id).select('+tokenHash').lean();
  assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.tokenHash, token);
  assert.ok(!JSON.stringify(logRecords).includes(token), 'the link never reaches the logs');
  assert.ok(logRecords.some((record) => record.change?.field === 'invitation' && record.change.to === 'created'));

  // The register page can read who it is for. Listing never shows the secret.
  const described = await lookUp(token);
  assert.equal(described.status, 200, described.text);
  assert.deepEqual([described.body.email, described.body.organisation], ['New.Person@example.test', { id: 'org-acme', name: 'Acme Labs' }]);
  const listed = await api().get('/api/organisation/invitations').set(auth(tokens.admin));
  assert.equal(listed.body[0].email, 'New.Person@example.test');
  assert.equal(listed.body[0].token, undefined);
  assert.ok(!JSON.stringify(listed.body).includes(token));

  // Only for its address (case doesn't matter), and only once.
  const wrongEmail = await register('someone.else@example.test', token);
  assert.equal(wrongEmail.status, 400);
  assert.match(wrongEmail.body.fields.email, /New\.Person@example\.test/);
  const joined = await register('new.person@EXAMPLE.test', token);
  assert.equal(joined.status, 201, joined.text);
  assert.equal(joined.body.role, 'Member');
  assert.deepEqual(joined.body.organisation, { id: 'org-acme', name: 'Acme Labs' });
  await signIn('new.person@EXAMPLE.test');
  const again = await register('another.person@example.test', token);
  assert.equal(again.status, 410);
  assert.equal(again.body.errorCode, 'INVITATION_USED');
  assert.equal((await lookUp(token)).body.errorCode, 'INVITATION_USED');

  const record = (await api().get('/api/organisation/invitations').set(auth(tokens.admin))).body[0];
  assert.equal(record.state, 'accepted');
  assert.ok(record.acceptedAt);
  assert.equal((await Invitation.findById(record.id).lean()).acceptedById, joined.body.userId);
  // A used link has nothing left to revoke.
  const revokeUsed = await api().delete(`/api/organisation/invitations/${record.id}`).set(auth(tokens.admin));
  assert.equal(revokeUsed.status, 409);
  assert.equal(revokeUsed.body.errorCode, 'INVITATION_USED');
});

test('revoked, expired, replaced and made-up links do not work', async () => {
  const revoked = (await invite('revoked@example.test')).body;
  const revoke = await api().delete(`/api/organisation/invitations/${revoked.id}`).set(auth(tokens.admin));
  assert.equal(revoke.status, 200, revoke.text);
  assert.equal(revoke.body.state, 'revoked');
  const revokeAgain = await api().delete(`/api/organisation/invitations/${revoked.id}`).set(auth(tokens.admin));
  assert.deepEqual([revokeAgain.status, revokeAgain.body.revokedAt], [200, revoke.body.revokedAt]);
  assert.equal((await lookUp(revoked.token)).body.errorCode, 'INVITATION_REVOKED');
  const lateJoin = await register('revoked@example.test', revoked.token);
  assert.deepEqual([lateJoin.status, lateJoin.body.errorCode], [410, 'INVITATION_REVOKED']);

  const expired = (await invite('expired@example.test')).body;
  await Invitation.updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await lookUp(expired.token)).status, 410);
  const expiredJoin = await register('expired@example.test', expired.token);
  assert.deepEqual([expiredJoin.status, expiredJoin.body.errorCode], [410, 'INVITATION_EXPIRED']);
  assert.equal(await User.exists({ emailNormalized: 'expired@example.test' }), null);

  // A new link for the same address replaces the old one.
  const first = (await invite('twice@example.test')).body;
  const second = (await invite('twice@example.test')).body;
  assert.equal((await lookUp(first.token)).body.errorCode, 'INVITATION_REVOKED');
  assert.equal((await lookUp(second.token)).status, 200);
  const states = (await api().get('/api/organisation/invitations').set(auth(tokens.admin))).body
    .filter((item) => item.email === 'twice@example.test').map((item) => item.state);
  assert.deepEqual(states, ['pending', 'revoked']);

  const madeUp = await lookUp('A'.repeat(32));
  assert.deepEqual([madeUp.status, madeUp.body.errorCode], [404, 'INVITATION_NOT_FOUND']);
  assert.equal((await lookUp('short')).status, 404);

  // Someone who already has an account can't be invited.
  const existing = await invite('member@example.test');
  assert.deepEqual([existing.status, existing.body.errorCode], [409, 'DUPLICATE_EMAIL']);
  assert.ok(existing.body.fields.email);
  assert.equal((await invite('not an email')).status, 400);
});

test('only Admins create, list and revoke links, and only in their own organisation', async () => {
  const link = (await invite('guarded@example.test')).body;
  for (const who of ['lead', 'member', 'viewer']) {
    assert.equal((await invite('nope@example.test', who)).status, 403, who);
    assert.equal((await api().get('/api/organisation/invitations').set(auth(tokens[who]))).status, 403, who);
    assert.equal((await api().delete(`/api/organisation/invitations/${link.id}`).set(auth(tokens[who]))).status, 403, who);
  }
  assert.equal((await api().get('/api/organisation/invitations')).status, 401);
  assert.equal((await api().post('/api/organisation/invitations').send({ email: 'x@example.test' })).status, 401);

  // Northwind's admin can't see or revoke Acme's links.
  assert.deepEqual((await api().get('/api/organisation/invitations').set(auth(tokens.northwind))).body, []);
  assert.equal((await api().delete(`/api/organisation/invitations/${link.id}`).set(auth(tokens.northwind))).status, 404);
  assert.equal((await lookUp(link.token)).status, 200);

  // A link already says where it joins: no invite code or organisation name alongside it.
  const mixed = await register('guarded@example.test', link.token, { joinCode: 'ACMELABS' });
  assert.equal(mixed.status, 400);
  assert.ok(mixed.body.fields.inviteToken);
  const named = await register('guarded@example.test', link.token, { organisationName: 'Elsewhere' });
  assert.equal(named.status, 400);
  // Whoever registers with a link is a Member, whatever role they ask for.
  const joined = await register('guarded@example.test', link.token, { role: 'Admin' });
  assert.deepEqual([joined.status, joined.body.role], [201, 'Member']);
});
