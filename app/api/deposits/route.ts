import { NextResponse } from 'next/server';
import { walletSession } from '@/lib/wallet-auth';
import { confirmDeposit } from '@/lib/deposits';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  const address = await walletSession(req);
  if (!address) return NextResponse.json({ error: 'Connect your wallet again.' }, { status: 401 });
  try {
    const b = await req.json();
    return NextResponse.json({ challenge: await confirmDeposit(String(b.intentId), String(b.signedTransaction), address) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
