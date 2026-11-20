import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
process.env.LOCKRUN_DATA_FILE = join(mkdtempSync(join(tmpdir(), 'lockrun-wallet-')), 'challenges.json');

beforeEach(async t => {
  const { connection } = await import('../lib/solana-server');
  (t as TestContext).mock.method(connection, 'getGenesisHash', async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
});

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
  const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64'));
  const expected = Buffer.from(tx.message.serialize()).toString('base64');
  tx.sign([owner]);
  const signed = Buffer.from(tx.serialize()).toString('base64');
  assert.doesNotThrow(() => validateSignedDeposit(signed, expected, owner.publicKey.toBase58()));
  const tampered = VersionedTransaction.deserialize(Buffer.from(signed, 'base64'));
  tampered.message.compiledInstructions[1].data[1] ^= 1;
  tampered.sign([owner]);
  assert.throws(() => validateSignedDeposit(Buffer.from(tampered.serialize()).toString('base64'), expected, owner.publicKey.toBase58()));
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
  t.mock.method(connection, 'simulateTransaction', async () => ({ value: { err: 'InsufficientFundsForFee' } }));
  await assert.rejects(prepareDeposit({ id: 'failed', title: 'Test', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt: Date.now() + 60_000, creatorName: 'Runner', status: 'active', participants: [] }, owner.publicKey.toBase58(), 'Runner'), /Devnet SOL/);
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
  const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64'));
  tx.sign([donor]);
  const signed = Buffer.from(tx.serialize()).toString('base64');
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
  const tx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
  assert.equal(tx.version, 0);
  assert.equal(tx.message.header.numRequiredSignatures, 1, 'Phantom is the only signer');
  assert.ok(tx.signatures.every(sig => sig.every(n => n === 0)), 'Nothing is pre-signed before Phantom approval');
  assert.equal(tx.message.staticAccountKeys[0].toBase58(), owner.publicKey.toBase58(), 'The runner pays the fee');
  assert.ok(tx.message.compiledInstructions.length === 5 && tx.message.staticAccountKeys[tx.message.compiledInstructions[0].programIdIndex].toBase58() === 'ComputeBudget111111111111111111111111111111', 'Explicit compute and loaded-data limits come first');
  tx.sign([owner]); // succeeds only if the authenticated wallet is the transfer authority
  const original = Buffer.from(tx.serialize()).toString('base64');
  const bad = VersionedTransaction.deserialize(Buffer.from(original, 'base64'));
  bad.message.compiledInstructions[1].data[1] ^= 1;
  bad.sign([owner]);
  assert.equal((await POST(request({ action: 'submit', intentId: data.intentId, tx: Buffer.from(bad.serialize()).toString('base64') }))).status, 400);
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

test('simulation diagnostics distinguish token funds, SOL fees, and unrelated program failures', async () => {
  const { depositSimulationMessage } = await import('../lib/simulation-error');
  assert.match(depositSimulationMessage('InsufficientFundsForFee'), /Devnet SOL/);
  assert.match(depositSimulationMessage('InvalidAccountForFee'), /Devnet SOL/);
  assert.match(depositSimulationMessage({ InstructionError: [1, { Custom: 1 }] }, ['Program log: Error: insufficient funds']), /Devnet USDC/);
  assert.match(depositSimulationMessage({ InstructionError: [1, 'InvalidAccountData'] }, ['Program log: Error: InvalidAccountData']), /token account/);
  assert.match(depositSimulationMessage('BlockhashNotFound'), /blockhash/);
  assert.doesNotMatch(depositSimulationMessage({ InstructionError: [0, 'IncorrectProgramId'] }), /enough|balance/);
});

test('wallet receives precisely the v0 bytes simulated by the real SDK; unsigned refresh gets a fresh blockhash', async t => {
  const { connection } = await import('../lib/solana-server');
  const { prepareDeposit, refreshDeposit } = await import('../lib/deposits');
  const { insertChallenge } = await import('../lib/store');
  const { inspectWalletTransfer } = await import('../lib/wallet-transaction');
  const wallet = Keypair.generate();
  let block = 0;
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: ++block + 100 }));
  const simulated: string[] = [];
  // Deliberately don't mock simulateTransaction: the old SDK overload changed these bytes.
  t.mock.method(connection as any, '_rpcRequest', async (method: string, params: any[]) => {
    assert.equal(method, 'simulateTransaction');
    assert.equal(params[1].sigVerify, false);
    assert.equal(params[1].commitment, 'confirmed');
    simulated.push(params[0]);
    return { jsonrpc: '2.0', id: 'test', result: { context: { slot: 123 }, value: { err: null, logs: [] } } };
  });
  t.mock.method(connection, 'getFeeForMessage', async () => ({ value: 5000 }));
  const c = { id: 'fresh-tx', title: 'Test', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt: Date.now() + 60_000, creatorName: 'Runner', status: 'active' as const, participants: [] };
  await insertChallenge(c);
  const prepared = await prepareDeposit(c, wallet.publicKey.toBase58(), 'Runner');
  assert.equal(prepared.transaction, simulated[0]);
  assert.equal(prepared.summary.minContextSlot, 123);
  const tx = inspectWalletTransfer(Buffer.from(prepared.transaction, 'base64'), { from: wallet.publicKey.toBase58(), to: prepared.summary.recipient, amount: 10, feePayer: wallet.publicKey.toBase58() });
  assert.equal(tx.version, 0);
  assert.ok(tx.signatures.every(sig => sig.every(n => n === 0)));
  const fresh = await refreshDeposit(prepared.intentId, wallet.publicKey.toBase58());
  assert.notEqual(fresh.intentId, prepared.intentId);
  assert.equal(fresh.transaction, simulated[1]);
  await assert.rejects(refreshDeposit(fresh.intentId, Keypair.generate().publicKey.toBase58()));
  t.mock.restoreAll();
});

test('mainnet RPC cannot prepare a deposit even if the app claims Devnet', async t => {
  const { connection } = await import('../lib/solana-server');
  const { prepareDeposit } = await import('../lib/deposits');
  t.mock.method(connection, 'getGenesisHash', async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  const simulated = t.mock.method(connection, 'simulateTransaction', async () => { throw new Error('Must not simulate on Mainnet'); });
  await assert.rejects(prepareDeposit({ id: 'wrong-chain', title: 'Test', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt: Date.now() + 60_000, creatorName: 'Runner', status: 'active', participants: [] }, Keypair.generate().publicKey.toBase58(), 'Runner'), /network mismatch/);
  assert.equal(simulated.mock.callCount(), 0);
  t.mock.restoreAll();
});

test('browser inspection rejects a changed amount, authority instruction, or pre-signed request', async () => {
  const { buildWalletTransaction, inspectWalletTransfer } = await import('../lib/wallet-transaction');
  const { PublicKey, TransactionInstruction } = await import('@solana/web3.js');
  const { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, createApproveInstruction, getAssociatedTokenAddressSync } = await import('@solana/spl-token');
  const owner = Keypair.generate(), recipient = Keypair.generate().publicKey, mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const source = getAssociatedTokenAddressSync(mint, owner.publicKey), dest = getAssociatedTokenAddressSync(mint, recipient);
  const instructions = [createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, dest, recipient, mint), createTransferCheckedInstruction(source, mint, dest, owner.publicKey, 10_000_000n, 6), new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from('LockRun') })];
  const tx = buildWalletTransaction(owner.publicKey, instructions, recipient.toBase58());
  const expected = { from: owner.publicKey.toBase58(), to: recipient.toBase58(), amount: 10, feePayer: owner.publicKey.toBase58() };
  assert.doesNotThrow(() => inspectWalletTransfer(tx.serialize(), expected));
  assert.throws(() => inspectWalletTransfer(tx.serialize(), { ...expected, amount: 11 }));
  assert.throws(() => inspectWalletTransfer(tx.serialize(), { ...expected, to: Keypair.generate().publicKey.toBase58() }));
  const malicious = buildWalletTransaction(owner.publicKey, [...instructions, createApproveInstruction(source, recipient, owner.publicKey, 999_000_000n)], recipient.toBase58());
  assert.throws(() => inspectWalletTransfer(malicious.serialize(), expected));
  tx.sign([owner]);
  assert.throws(() => inspectWalletTransfer(tx.serialize(), expected), /before other signatures/);
});

test('previously signed legacy deposits can still be validated for recovery', async () => {
  const { validateSignedDeposit } = await import('../lib/deposits');
  const { SystemProgram } = await import('@solana/web3.js');
  const owner = Keypair.generate(), recipient = Keypair.generate().publicKey;
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash: recipient.toBase58(), lastValidBlockHeight: 100 }).add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: 1 }));
  tx.sign(owner);
  const validated = validateSignedDeposit(tx.serialize().toString('base64'), tx.serializeMessage().toString('base64'), owner.publicKey.toBase58());
  assert.equal(validated.version, 'legacy');
});

test('shop payments require login, use one wallet signer, bind to the order, and keep codes private', async t => {
  const { connection } = await import('../lib/solana-server');
  const { kvSet } = await import('../lib/store');
  const { GET, POST } = await import('../app/api/shop/route');
  const owner = Keypair.generate(), other = Keypair.generate(), store = Keypair.generate();
  process.env.SPONSOR_SECRET_KEY = bs58.encode(store.secretKey);
  const mine = 'f'.repeat(64), theirs = '1'.repeat(64);
  await kvSet(`session:${mine}`, { address: owner.publicKey.toBase58(), expires: Date.now() + 5000 });
  await kvSet(`session:${theirs}`, { address: other.publicKey.toBase58(), expires: Date.now() + 5000 });
  let confirmed = false;
  t.mock.method(connection, 'getTokenAccountBalance', async () => ({ value: { uiAmount: 100 } }));
  t.mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: other.publicKey.toBase58(), lastValidBlockHeight: 100 }));
  t.mock.method(connection, 'simulateTransaction', async () => ({ value: { err: null } }));
  t.mock.method(connection, 'getSignatureStatuses', async () => ({ value: [confirmed ? { confirmationStatus: 'confirmed', err: null } : null] }));
  const send = t.mock.method(connection, 'sendRawTransaction', async () => 'mock');
  t.mock.method(connection, 'confirmTransaction', async () => { confirmed = true; return { value: { err: null } }; });
  const req = (body: object, token?: string) => new Request('https://lockrun.test/api/shop', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { cookie: `lockrun_session=${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await POST(req({ action: 'prepare', itemId: 'cap' }))).status, 401);
  const prepared = await POST(req({ action: 'prepare', itemId: 'cap' }, mine));
  assert.equal(prepared.status, 200);
  const data = await prepared.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
  assert.equal(tx.message.header.numRequiredSignatures, 1);
  assert.ok(tx.signatures.every(sig => sig.every(n => n === 0)), 'Nothing is pre-signed');
  assert.equal(tx.message.staticAccountKeys[0].toBase58(), owner.publicKey.toBase58());
  const { inspectWalletTransfer } = await import('../lib/wallet-transaction');
  const { shopItem } = await import('../lib/shop');
  assert.doesNotThrow(() => inspectWalletTransfer(Buffer.from(data.tx, 'base64'), { from: owner.publicKey.toBase58(), to: store.publicKey.toBase58(), amount: shopItem('cap')!.price, feePayer: owner.publicKey.toBase58() }));
  tx.sign([owner]);
  const signed = Buffer.from(tx.serialize()).toString('base64');
  assert.equal((await POST(req({ action: 'submit', orderId: data.orderId, tx: signed }, theirs))).status, 404, 'another wallet cannot settle this order');
  const bad = VersionedTransaction.deserialize(Buffer.from(signed, 'base64'));
  bad.message.compiledInstructions[1].data[1] ^= 1; bad.sign([owner]);
  assert.equal((await POST(req({ action: 'submit', orderId: data.orderId, tx: Buffer.from(bad.serialize()).toString('base64') }, mine))).status, 500);
  assert.equal(send.mock.callCount(), 0);
  const ok = await POST(req({ action: 'submit', orderId: data.orderId, tx: signed }, mine));
  assert.equal(ok.status, 200);
  const order = (await ok.json()).order;
  assert.ok(order.code && !('message' in order));
  assert.equal((await POST(req({ action: 'submit', orderId: data.orderId, tx: signed }, mine))).status, 200);
  assert.equal(send.mock.callCount(), 1);
  const listed = (path: string | undefined) => GET(new Request('https://lockrun.test/api/shop', { headers: path ? { cookie: `lockrun_session=${path}` } : {} })).then(r => r.json());
  assert.equal((await listed(mine)).orders.length, 1);
  assert.equal((await listed(theirs)).orders.length, 0, 'codes are private to the buyer');
  assert.equal((await listed(undefined)).orders.length, 0);
  t.mock.restoreAll();
});

function room(over: Record<string, unknown> = {}, finished: boolean[] = [], deposit = 10, bonus = 0) {
  const runsRequired = 2;
  return {
    id: 'settle', title: 'T', goalKm: 3, runsRequired, deposit, createdAt: 0, endsAt: 1, creatorName: 'x', status: 'active' as const,
    sponsors: bonus ? [{ name: 's', amount: bonus, at: 0, sig: 'x' }] : [],
    participants: finished.map((done, i) => ({ name: `p${i}`, address: `a${i}`, joinedAt: 0, joinSig: 'j', runs: done ? [1, 2].map(n => ({ id: `${i}${n}`, km: 3, sec: 900, at: 0, counts: true })) : [{ id: `${i}x`, km: 3, sec: 900, at: 0, counts: true }] })),
    ...over,
  };
}

test('settlement follows the structure document: all finish, some finish, nobody finishes, sponsor bonus, 5% fee, rounding', async () => {
  const { computePayouts } = await import('../lib/settle');
  const total = (r: { payouts: { amount: number }[] }) => Math.round(r.payouts.reduce((s, p) => s + p.amount, 0) * 1e6);
  // All five finish, no bonus: everyone gets 10 back, no fee.
  let r = computePayouts(room({}, [true, true, true, true, true]));
  assert.deepEqual(r.payouts.map(p => p.amount), [10, 10, 10, 10, 10]); assert.equal(r.fee, 0);
  // Three of five finish: fee 1 USDC, finishers share 49.
  r = computePayouts(room({}, [true, true, true, false, false]));
  assert.equal(r.fee, 1); assert.equal(total(r), 49_000_000);
  assert.deepEqual(r.payouts.map(p => p.amount), [16.333334, 16.333333, 16.333333, 0, 0]);
  assert.ok(r.payouts.slice(3).every(p => p.tier === 'forfeited'));
  // All finish with a 10 USDC bonus: 12 each.
  r = computePayouts(room({}, [true, true, true, true, true], 10, 10));
  assert.deepEqual(r.payouts.map(p => p.amount), [12, 12, 12, 12, 12]); assert.equal(r.fee, 0);
  // Nobody finishes: refunds, bonus returned, no fee.
  r = computePayouts(room({}, [false, false, false, false, false], 10, 10));
  assert.deepEqual(r.payouts.map(p => p.amount), [10, 10, 10, 10, 10]);
  assert.ok(r.payouts.every(p => p.tier === 'refund')); assert.equal(r.sponsorRefund, 10); assert.equal(r.fee, 0);
  // Money never exceeds the pot minus the fee.
  r = computePayouts(room({}, [true, false, false, true, false], 7, 25));
  assert.equal(total(r) + Math.round(r.fee * 1e6), Math.round(r.pot * 1e6));
});

test('check-ins need a server session, one photo, and one counted run per room day; fast paces wait for review', async t => {
  const { connection } = await import('../lib/solana-server');
  const { insertChallenge, getChallenge, kvSet } = await import('../lib/store');
  const { POST } = await import('../app/api/challenges/[id]/route');
  const { roomDay } = await import('../lib/config');
  const runner = Keypair.generate();
  process.env.SPONSOR_SECRET_KEY = bs58.encode(Keypair.generate().secretKey);
  t.mock.method(connection, 'getLatestBlockhash', async () => { throw new Error('offline'); }); // proof stamping is best effort
  const token = '2'.repeat(64);
  await kvSet(`session:${token}`, { address: runner.publicKey.toBase58(), expires: Date.now() + 60_000 });
  const now = Date.now();
  const c = { id: 'checkin', title: 'T', goalKm: 3, runsRequired: 2, deposit: 10, createdAt: now, endsAt: now + 3 * 86_400_000, creatorName: 'R', timeZone: 'America/Vancouver', status: 'active' as const, participants: [{ name: 'R', address: runner.publicKey.toBase58(), joinedAt: now, joinSig: 'j', runs: [] }] };
  await insertChallenge(c);
  const photo = 'data:image/jpeg;base64,' + Buffer.from('x'.repeat(64)).toString('base64');
  const call = (body: object) => POST(new Request('https://lockrun.test/api/challenges/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', cookie: `lockrun_session=${token}` }, body: JSON.stringify(body) }), { params: { id: 'checkin' } });
  const start = async () => (await (await call({ action: 'start' })).json()).sessionId as string;
  const desktop = await POST(new Request('https://lockrun.test/api/challenges/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120', cookie: `lockrun_session=${token}` }, body: JSON.stringify({ action: 'start' }) }), { params: { id: 'checkin' } });
  assert.equal(desktop.status, 403, 'computers cannot check in');
  assert.equal((await call({ action: 'run', km: 3, sec: 900, photo, sessionId: 'a'.repeat(20) })).status, 403, 'unknown session');
  const s1 = await start();
  assert.equal((await call({ action: 'run', km: 3, sec: 900, sessionId: s1 })).status, 400, 'photo required');
  // Reported time longer than the session actually lasted is rejected (and stored with a reason).
  const lie = await (await call({ action: 'run', km: 3, sec: 900, photo, sessionId: s1 })).json();
  assert.equal(lie.run.status, 'rejected'); assert.match(lie.reason, /longer than the run session/);
  assert.equal((await call({ action: 'run', km: 3, sec: 900, photo, sessionId: s1 })).status, 409, 'a session submits once');
  // Backdate a session so a valid-looking 25 min / 5 km run is plausible: approved.
  const s2 = await start();
  await kvSet(`runsession:${s2}`, { challengeId: 'checkin', address: runner.publicKey.toBase58(), startedAt: Date.now() - 40 * 60_000 });
  const ok = await (await call({ action: 'run', km: 5, sec: 1500, photo, sessionId: s2 })).json();
  assert.equal(ok.run.status, 'approved'); assert.equal(ok.run.roomDay, roomDay(Date.now() - 40 * 60_000, 'America/Vancouver'));
  // A second check-in for the same room day is refused; it does not create a qualifying day.
  const s3 = await start();
  await kvSet(`runsession:${s3}`, { challengeId: 'checkin', address: runner.publicKey.toBase58(), startedAt: Date.now() - 30 * 60_000 });
  assert.equal((await call({ action: 'run', km: 5, sec: 1500, photo, sessionId: s3 })).status, 409);
  const after = await getChallenge('checkin');
  assert.equal(after!.participants[0].runs.filter(r => r.counts).length, 1);
  assert.equal(after!.participants[0].runs.length, 2);
});

test('very fast runs wait for review, hold the day slot, hold settlement, and only the verifier key can decide', async t => {
  const { connection } = await import('../lib/solana-server');
  const { insertChallenge, getChallenge, kvSet } = await import('../lib/store');
  const { POST } = await import('../app/api/challenges/[id]/route');
  const runner = Keypair.generate();
  process.env.SPONSOR_SECRET_KEY = bs58.encode(Keypair.generate().secretKey);
  process.env.VERIFIER_KEY = 'verifier-secret-123';
  t.mock.method(connection, 'getLatestBlockhash', async () => { throw new Error('offline'); });
  const token = '3'.repeat(64);
  await kvSet(`session:${token}`, { address: runner.publicKey.toBase58(), expires: Date.now() + 60_000 });
  const now = Date.now();
  await insertChallenge({ id: 'review', title: 'T', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: now - 7200_000, endsAt: now + 3600_000, creatorName: 'R', status: 'active' as const, participants: [{ name: 'R', address: runner.publicKey.toBase58(), joinedAt: now - 7200_000, joinSig: 'j', runs: [] }] });
  const photo = 'data:image/jpeg;base64,' + Buffer.from('y'.repeat(64)).toString('base64');
  const call = (body: object, headers: Record<string, string> = {}) => POST(new Request('https://lockrun.test/api/challenges/review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Mobile', cookie: `lockrun_session=${token}`, ...headers }, body: JSON.stringify(body) }), { params: { id: 'review' } });
  const { sessionId } = await (await call({ action: 'start' })).json();
  await kvSet(`runsession:${sessionId}`, { challengeId: 'review', address: runner.publicKey.toBase58(), startedAt: Date.now() - 30 * 60_000 });
  const sent = await (await call({ action: 'run', km: 3, sec: 480, photo, sessionId })).json(); // 2:40/km
  assert.equal(sent.run.status, 'pending'); assert.equal(sent.run.counts, false);
  const { sessionId: again } = await (await call({ action: 'start' })).json();
  await kvSet(`runsession:${again}`, { challengeId: 'review', address: runner.publicKey.toBase58(), startedAt: Date.now() - 20 * 60_000 });
  assert.equal((await call({ action: 'run', km: 3, sec: 1000, photo, sessionId: again })).status, 409, 'pending holds the day slot');
  assert.equal((await call({ action: 'review', runId: sent.run.id, decision: 'approve' })).status, 403, 'participants cannot approve their own run');
  assert.equal((await call({ action: 'review', runId: sent.run.id, decision: 'approve' }, { 'x-verifier-key': 'verifier-secret-123' })).status, 200);
  const done = await getChallenge('review');
  assert.equal(done!.participants[0].runs[0].counts, true);
  delete process.env.VERIFIER_KEY;
});

test('fraction mode keeps the 100% / 85% / partial tiers; pool mode is the default', async () => {
  const { computePayouts } = await import('../lib/settle');
  // 3 runners x $20, $75 bonus, 2 runs required: Maria 2/2, Daniel 1/2, Kevin 0/2 -> Maria gets $125.
  const c = { ...room({}, [true, false, false], 20, 0), rewardMode: 'fraction' as const, sponsors: [{ name: 's', amount: 75, at: 0, sig: 'x' }] };
  c.participants[2].runs = [];
  const r = computePayouts(c);
  assert.deepEqual(r.payouts.map(p => p.amount), [125, 10, 0]);
  assert.deepEqual(r.payouts.map(p => p.tier), ['finished', 'partial', 'partial']);
  assert.equal(r.fee, 0);
  // The same results under the default pool mode: Daniel and Kevin forfeit.
  const pool = computePayouts({ ...c, rewardMode: undefined });
  assert.deepEqual(pool.payouts.map(p => p.tier), ['finished', 'forfeited', 'forfeited']);
  assert.equal(pool.payouts[0].amount, 20 * 3 + 75 - 2 * 20 * 0.05);
});

test('private challenges are hidden from strangers and the list, and need the invite link to join', async () => {
  const { insertChallenge, kvSet } = await import('../lib/store');
  const { GET: list } = await import('../app/api/challenges/route');
  const { GET, POST } = await import('../app/api/challenges/[id]/route');
  const host = Keypair.generate(), friend = Keypair.generate(), stranger = Keypair.generate();
  const cookie = async (kp: Keypair, tok: string) => { await kvSet(`session:${tok}`, { address: kp.publicKey.toBase58(), expires: Date.now() + 60_000 }); return `lockrun_session=${tok}`; };
  const hostCookie = await cookie(host, '4'.repeat(64)), strangerCookie = await cookie(stranger, '5'.repeat(64)), friendCookie = await cookie(friend, '6'.repeat(64));
  const now = Date.now();
  const base = { title: 'Priv', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: now, endsAt: now + 86_400_000, creatorName: 'H', status: 'active' as const, participants: [{ name: 'H', address: host.publicKey.toBase58(), joinedAt: now, joinSig: 'j', runs: [] }] };
  await insertChallenge({ ...base, id: 'priv', visibility: 'private', inviteCode: 'c0ffee'.repeat(4) });
  await insertChallenge({ ...base, id: 'pub', visibility: 'public' });
  const get = (id: string, ck?: string, q = '') => GET(new Request(`https://lockrun.test/api/challenges/${id}${q}`, { headers: ck ? { cookie: ck } : {} }), { params: { id } });
  assert.equal((await get('priv')).status, 404);
  assert.equal((await get('priv', strangerCookie)).status, 404);
  const viaInvite = await get('priv', strangerCookie, '?invite=' + 'c0ffee'.repeat(4));
  assert.equal(viaInvite.status, 200);
  assert.equal((await viaInvite.json()).challenge.inviteCode, undefined, 'the code is not echoed to non-members');
  assert.equal((await (await get('priv', hostCookie)).json()).challenge.inviteCode, 'c0ffee'.repeat(4), 'members can share it');
  assert.equal((await get('pub')).status, 200);
  const ids = async (ck?: string) => (await (await list(new Request('https://lockrun.test/api/challenges', { headers: ck ? { cookie: ck } : {} }))).json()).challenges.map((c: { id: string }) => c.id);
  assert.ok(!(await ids()).includes('priv') && (await ids()).includes('pub'));
  assert.ok(!(await ids(strangerCookie)).includes('priv'));
  assert.ok((await ids(hostCookie)).includes('priv'));
  const act = (ck: string, body: object) => POST(new Request('https://lockrun.test/api/challenges/priv', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ck }, body: JSON.stringify(body) }), { params: { id: 'priv' } });
  assert.equal((await act(friendCookie, { action: 'join', name: 'F' })).status, 404, 'no invite, no join');
  assert.equal((await act(friendCookie, { action: 'join', name: 'F', invite: 'wrong'.repeat(5) })).status, 404);
  assert.equal((await act(strangerCookie, { action: 'settle' })).status, 404, 'strangers cannot act on a private challenge');
});
