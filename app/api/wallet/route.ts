import { NextResponse } from 'next/server';
import { authCookie, sessionToken, useNonce, walletSession } from '@/lib/wallet-auth';
import { kvSet } from '@/lib/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const id = sessionToken();
  const message = `Sign in to Lock&Run\nOrigin: ${new URL(req.url).origin}\nNetwork: Solana Devnet\nNonce: ${id}\nThis signature proves wallet ownership. It does not transfer funds.`;
  await kvSet(`nonce:${id}`, { message, expires: Date.now() + 300_000 });
  return NextResponse.json({ id, message, address: await walletSession(req) });
}
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!await useNonce(String(b.id), String(b.address), String(b.signature))) return NextResponse.json({ error: 'Wallet signature invalid or expired.' }, { status: 401 });
  const token = sessionToken();
  await kvSet(`session:${token}`, { address: b.address, expires: Date.now() + 24 * 3600_000 });
  const res = NextResponse.json({ address: b.address });
  res.cookies.set(authCookie, token, { httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 86400 });
  return res;
}
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookie, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
