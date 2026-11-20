import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { PublicKey, Transaction } from '@solana/web3.js';
import { prepareWithdraw, submitWithdraw, usdcBalance } from '@/lib/solana-server';
import { walletSession } from '@/lib/wallet-auth';
import { requireDurableStorage } from '@/lib/deposits';
import { kvGet, kvSet } from '@/lib/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Withdrawal = { address: string; message: string; signed?: string };
export async function GET(req: Request) {
  const address = await walletSession(req);
  if (!address) return NextResponse.json({ error: 'Connect your wallet first.' }, { status: 401 });
  try { return NextResponse.json({ usdc: await usdcBalance(address) }); }
  catch { return NextResponse.json({ error: 'Balance unavailable.' }, { status: 503 }); }
}
export async function POST(req: Request) {
  const address = await walletSession(req);
  if (!address) return NextResponse.json({ error: 'Connect your wallet first.' }, { status: 401 });
  try {
    requireDurableStorage();
    const b = await req.json();
    if (b.action === 'prepare') {
      const to = new PublicKey(String(b.to)).toBase58();
      const amount = Number(b.amount);
      if (to === address || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 1e6 - Math.round(amount * 1e6)) > 0.0001) throw new Error('Enter a different recipient and a positive USDC amount with up to six decimals.');
      if (amount > await usdcBalance(address)) throw new Error('Not enough test USDC.');
      const tx = await prepareWithdraw(address, to, amount);
      const message = Transaction.from(Buffer.from(tx, 'base64')).serializeMessage().toString('base64');
      const intentId = createHash('sha256').update(message).digest('hex');
      await kvSet(`withdrawal:${intentId}`, { address, message } satisfies Withdrawal);
      return NextResponse.json({ tx, intentId });
    }
    if (b.action === 'submit') {
      if (!/^[a-f0-9]{64}$/.test(b.intentId) || typeof b.tx !== 'string' || b.tx.length > 4096) throw new Error('Invalid withdrawal.');
      const intent = await kvGet<Withdrawal>(`withdrawal:${b.intentId}`);
      const tx = Transaction.from(Buffer.from(b.tx, 'base64'));
      if (!intent || intent.address !== address || tx.serializeMessage().toString('base64') !== intent.message || !tx.verifySignatures() || !tx.signatures.some(s => s.publicKey.toBase58() === address && s.signature)) throw new Error('Withdrawal does not match this wallet’s prepared transfer.');
      if (intent.signed && intent.signed !== b.tx) throw new Error('A different signed transfer was already submitted.');
      await kvSet(`withdrawal:${b.intentId}`, { ...intent, signed: b.tx });
      return NextResponse.json({ signature: await submitWithdraw(b.tx) });
    }
    throw new Error('Unknown action.');
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
