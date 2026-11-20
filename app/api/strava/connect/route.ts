import { walletSession, walletAuthFailure } from "@/lib/wallet-auth";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { authorizeUrl, signState, stravaEnabled } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/strava/connect?address=<wallet>&back=/c/<id>  ->  sends the runner to Strava to approve access
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!stravaEnabled()) return NextResponse.json({ error: "Strava isn't set up on this server." }, { status: 501 });
  const address = await walletSession(req);
  if (!address) return walletAuthFailure();
  try {
    new PublicKey(address);
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const back = (url.searchParams.get("back") || "/").startsWith("/") ? url.searchParams.get("back") || "/" : "/";
  return NextResponse.redirect(authorizeUrl(url.origin, signState({ address, back })));
}
