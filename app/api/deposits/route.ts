import { NextResponse } from 'next/server';
import { walletSession, walletAuthFailure } from '@/lib/wallet-auth';
import { confirmDeposit } from '@/lib/deposits';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  const address = await walletSession(req);
  if (!address) return walletAuthFailure();
  try {
    const b = await req.json();
    return NextResponse.json({ challenge: await confirmDeposit(String(b.intentId), String(b.signedTransaction), address) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
