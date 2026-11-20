import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
process.env.LOCKRUN_DATA_FILE = join(mkdtempSync(join(tmpdir(), 'lockrun-wallet-')), 'challenges.json');

// Ephemeral test keys only. Every RPC call in these tests is mocked.
test('wallet login rejects different messages, different wallets, expired and reused nonces', async () => {
  const { verifyWalletMessage, useNonce } = await import('../lib/wallet-auth');
  const { kvSet } = await import('../lib/store');
  const pair = generateKeyPairSync('ed25519');
  const address = bs58.encode(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const message = 'LockRun origin-bound test nonce';
  const signature = bs58.encode(sign(null, Buffer.from(message), pair.privateKey));
  assert.equal(verifyWalletMessage(address, message, signature), true);
  assert.equal(verifyWalletMessage(address, message + 'tampered', signature), false);
  assert.equal(verifyWalletMessage(Keypair.generate().publicKey.toBase58(), message, signature), false);
  assert.equal(verifyWalletMessage('bad', message, signature), false);
  const nonce = 'a'.repeat(64);
  await kvSet(`nonce:${nonce}`, { message, expires: Date.now() + 5000 });
  assert.equal(await useNonce(nonce, address, signature), true);
  assert.equal(await useNonce(nonce, address, signature), false);
  await kvSet(`nonce:${nonce}`, { message, expires: Date.now() - 1 });
  assert.equal(await useNonce(nonce, address, signature), false);
});

test('confirmed deposits register once; tampering and foreign wallets cannot broadcast', async t => {
  const { connection } = await import('../lib/solana-server');
  const { prepareDeposit, confirmDeposit, validateSignedDeposit } = await import('../lib/deposits');
  const { insertChallenge, getChallenge } = await import('../lib/store');
  const owner = Keypair.generate();
  const escrow = Keypair.generate();
  process.env.ESCROW_SECRET_KEY = bs58.encode(escrow.secretKey);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const lifetime = { blockhash, lastValidBlockHeight: 100 };
  t.mock.method(connection, 'getLatestBlockhash', async () => lifetime);
  t.mock.method(connection, 'simulateTransaction', async () => ({ value: { err: null } }));
  t.mock.method(connection, 'getFeeForMessage', async () => ({ value: 5000 }));
  const statuses = t.mock.method(connection, 'getSignatureStatuses', async () => ({ value: [null] }));
  const send = t.mock.method(connection, 'sendRawTransaction', async () => 'mock');
  t.mock.method(connection, 'confirmTransaction', async () => ({ value: { err: null } }));
  const c = { id: 'wallet-test', title: 'Test', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt: Date.now() + 60_000, creatorName: 'Runner', status: 'draft' as const, participants: [] };
  await insertChallenge(c);
  const prepared = await prepareDeposit(c, owner.publicKey.toBase58(), 'Runner');
  const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  const expected = tx.serializeMessage().toString('base64');
  tx.sign(owner);
  const signed = tx.serialize().toString('base64');
  assert.doesNotThrow(() => validateSignedDeposit(signed, expected, owner.publicKey.toBase58()));
  const tampered = Transaction.from(Buffer.from(signed, 'base64'));
  tampered.instructions[1].data[1] ^= 1;
  tampered.sign(owner);
  assert.throws(() => validateSignedDeposit(tampered.serialize().toString('base64'), expected, owner.publicKey.toBase58()));
  assert.throws(() => validateSignedDeposit(prepared.transaction, expected, owner.publicKey.toBase58()));
  await assert.rejects(confirmDeposit(prepared.intentId, signed, escrow.publicKey.toBase58()));
  assert.equal(send.mock.callCount(), 0);
  const first = await confirmDeposit(prepared.intentId, signed, owner.publicKey.toBase58());
  assert.equal(first?.status, 'active');
  assert.equal(first?.participants[0].address, owner.publicKey.toBase58());
  assert.equal(send.mock.callCount(), 1);
  await confirmDeposit(prepared.intentId, signed, owner.publicKey.toBase58());
  assert.equal(send.mock.callCount(), 1);
  assert.equal((await getChallenge(c.id))?.participants.length, 1);
  assert.equal((await getChallenge(c.id))?.pendingDeposits?.length, 0);
  assert.equal(statuses.mock.callCount(), 1);
  t.mock.restoreAll();
});

test('failed simulation returns no deposit to sign', async t => {
  const { connection } = await import('../lib/solana-server');
  const { prepareDeposit } = await import('../lib/deposits');
  const owner = Keypair.generate();
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: owner.publicKey.toBase58(), lastValidBlockHeight: 100 }));
  t.mock.method(connection, 'simulateTransaction', async () => ({ value: { err: { InsufficientFundsForFee: null } } }));
  await assert.rejects(prepareDeposit({ id: 'failed', title: 'Test', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt: Date.now() + 60_000, creatorName: 'Runner', status: 'active', participants: [] }, owner.publicKey.toBase58(), 'Runner'), /simulation failed/);
  t.mock.restoreAll();
});

test('only the owner can release a live lock', async () => {
  const { acquireLock, releaseLock } = await import('../lib/store');
  const token = await acquireLock('test-lock');
  assert.ok(token);
  await releaseLock('test-lock', 'incorrect-token');
  assert.equal(await acquireLock('test-lock'), null);
  await releaseLock('test-lock', token);
  const next = await acquireLock('test-lock');
  assert.ok(next);
  await releaseLock('test-lock', next);
});

test('payout retry reuses the recorded transfer and keeps its destination', async t => {
  const { connection, payFromEscrow } = await import('../lib/solana-server');
  const { kvGet } = await import('../lib/store');
  const sponsor = Keypair.generate(), recipient = Keypair.generate();
  process.env.SPONSOR_SECRET_KEY = bs58.encode(sponsor.secretKey);
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: sponsor.publicKey.toBase58(), lastValidBlockHeight: 100 }));
  let confirmed = false;
  t.mock.method(connection, 'getSignatureStatuses', async () => ({ value: [confirmed ? { confirmationStatus: 'confirmed', err: null } : null] }));
  const send = t.mock.method(connection, 'sendRawTransaction', async () => 'mock');
  t.mock.method(connection, 'confirmTransaction', async () => { confirmed = true; throw new Error('Response interrupted after confirmation'); });
  const destination = recipient.publicKey.toBase58();
  await assert.rejects(payFromEscrow('payout-test', destination, 10));
  const payment = await kvGet<{ signature: string; raw: string }>(`payout:payout-test:${destination}`);
  assert.ok(payment);
  const sig = await payFromEscrow('payout-test', destination, 10);
  assert.equal(sig, payment.signature);
  assert.equal(send.mock.callCount(), 1);
  assert.ok(Transaction.from(Buffer.from(payment.raw, 'base64')).verifySignatures());
  await assert.rejects(payFromEscrow('payout-test', destination, 20), /amount differs/);
  t.mock.restoreAll();
});

test('sponsor funding confirms once without registering a runner and retains refund ownership', async t => {
  const { connection } = await import('../lib/solana-server');
  const { prepareDeposit, confirmDeposit } = await import('../lib/deposits');
  const { insertChallenge, getChallenge } = await import('../lib/store');
  const { computePayouts } = await import('../lib/settle');
  const donor = Keypair.generate();
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: donor.publicKey.toBase58(), lastValidBlockHeight: 100 }));
  t.mock.method(connection, 'simulateTransaction', async () => ({ value: { err: null } }));
  t.mock.method(connection, 'getFeeForMessage', async () => ({ value: 5000 }));
  t.mock.method(connection, 'getSignatureStatuses', async () => ({ value: [null] }));
  const send = t.mock.method(connection, 'sendRawTransaction', async () => 'mock');
  t.mock.method(connection, 'confirmTransaction', async () => ({ value: { err: null } }));
  const c = { id: 'sponsor-test', title: 'Test', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt: Date.now() + 60_000, creatorName: 'Runner', status: 'active' as const, participants: [] };
  await insertChallenge(c);
  await assert.rejects(prepareDeposit(c, donor.publicKey.toBase58(), 'Brand', { amount: 999 }), /invalid/);
  const prepared = await prepareDeposit(c, donor.publicKey.toBase58(), 'Brand', { amount: 25, url: 'https://example.com' });
  assert.equal(prepared.summary.amount, 25);
  assert.equal(prepared.summary.kind, 'sponsor');
  const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  tx.sign(donor);
  const signed = tx.serialize().toString('base64');
  const first = await confirmDeposit(prepared.intentId, signed, donor.publicKey.toBase58());
  assert.equal(first?.participants.length, 0);
  assert.equal(first?.sponsors?.[0].address, donor.publicKey.toBase58());
  assert.equal(first?.sponsors?.[0].amount, 25);
  assert.equal(computePayouts(first!).sponsorRefund, 25);
  await confirmDeposit(prepared.intentId, signed, donor.publicKey.toBase58());
  assert.equal(send.mock.callCount(), 1);
  assert.equal((await getChallenge(c.id))?.sponsors?.length, 1);
  await assert.rejects(prepareDeposit(first!, donor.publicKey.toBase58(), 'Again', { amount: 50 }), /already sponsors/);
  t.mock.restoreAll();
});

test('sponsor refunds and runner payouts cannot reuse each other’s transfer', async t => {
  const { connection, payFromEscrow } = await import('../lib/solana-server');
  const recipient = Keypair.generate().publicKey.toBase58();
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }));
  t.mock.method(connection, 'getSignatureStatuses', async () => ({ value: [null] }));
  const send = t.mock.method(connection, 'sendRawTransaction', async () => 'mock');
  t.mock.method(connection, 'confirmTransaction', async () => ({ value: { err: null } }));
  const reward = await payFromEscrow('both-roles', recipient, 10);
  const refund = await payFromEscrow('both-roles', recipient, 10, 'sponsor-refund');
  assert.notEqual(reward, refund);
  assert.equal(send.mock.callCount(), 2);
  t.mock.restoreAll();
});

test('withdrawals require login, bind sender and recipient, and retry without another payment', async t => {
  const { connection } = await import('../lib/solana-server');
  const { kvSet } = await import('../lib/store');
  const { POST } = await import('../app/api/withdrawals/route');
  const owner = Keypair.generate(), recipient = Keypair.generate();
  const token = 'e'.repeat(64);
  await kvSet(`session:${token}`, { address: owner.publicKey.toBase58(), expires: Date.now() + 5000 });
  let confirmed = false;
  t.mock.method(connection, 'getTokenAccountBalance', async () => ({ value: { uiAmount: 100 } }));
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: recipient.publicKey.toBase58(), lastValidBlockHeight: 100 }));
  t.mock.method(connection, 'simulateTransaction', async () => ({ value: { err: null } }));
  t.mock.method(connection, 'getSignatureStatuses', async () => ({ value: [confirmed ? { confirmationStatus: 'confirmed', err: null } : null] }));
  const send = t.mock.method(connection, 'sendRawTransaction', async () => 'mock');
  t.mock.method(connection, 'confirmTransaction', async () => { confirmed = true; return { value: { err: null } }; });
  const request = (body: object, authenticated = true) => new Request('https://lockrun.test/api/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { cookie: `lockrun_session=${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ action: 'prepare' }, false))).status, 401);
  const prepared = await POST(request({ action: 'prepare', from: recipient.publicKey.toBase58(), to: recipient.publicKey.toBase58(), amount: 10 }));
  assert.equal(prepared.status, 200);
  const data = await prepared.json();
  const tx = Transaction.from(Buffer.from(data.tx, 'base64'));
  tx.partialSign(owner); // succeeds only if the authenticated wallet is the transfer authority
  const original = tx.serialize().toString('base64');
  const bad = Transaction.from(Buffer.from(original, 'base64'));
  bad.instructions[1].data[1] ^= 1;
  bad.partialSign(owner);
  assert.equal((await POST(request({ action: 'submit', intentId: data.intentId, tx: bad.serialize({ verifySignatures: false }).toString('base64') }))).status, 400);
  assert.equal(send.mock.callCount(), 0);
  const first = await POST(request({ action: 'submit', intentId: data.intentId, tx: original }));
  assert.equal(first.status, 200);
  const second = await POST(request({ action: 'submit', intentId: data.intentId, tx: original }));
  assert.equal(second.status, 200);
  assert.equal((await first.json()).signature, (await second.json()).signature);
  assert.equal(send.mock.callCount(), 1);
  t.mock.restoreAll();
});

test('Vercel without shared storage reports setup failure instead of a disconnected wallet', async () => {
  const { GET, POST } = await import('../app/api/wallet/route');
  const { POST: create } = await import('../app/api/challenges/route');
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const nonce = await GET(new Request('https://lockrun.test/api/wallet'));
    assert.equal(nonce.status, 503);
    assert.equal((await nonce.json()).code, 'SHARED_STORAGE_UNAVAILABLE');
    const login = await POST(new Request('https://lockrun.test/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    assert.equal(login.status, 503);
    assert.equal(login.headers.get('set-cookie'), null);
    const challenge = await create(new Request('https://lockrun.test/api/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    assert.equal(challenge.status, 503);
    assert.equal((await challenge.json()).code, 'SHARED_STORAGE_UNAVAILABLE');
  } finally {
    if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
  }
});
