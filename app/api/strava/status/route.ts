import { walletSession } from "@/lib/wallet-auth";
import { NextResponse } from "next/server";
import { connectedAthlete, stravaEnabled } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/strava/status?address=<wallet>  ->  { enabled, athlete }
export async function GET(req: Request) {
  const address = await walletSession(req);
  if (!address) return NextResponse.json({ enabled: false, athlete: null }, { status: 401 });
  if (!stravaEnabled()) return NextResponse.json({ enabled: false, athlete: null });
  return NextResponse.json({ enabled: true, athlete: address ? await connectedAthlete(address) : null });
}
