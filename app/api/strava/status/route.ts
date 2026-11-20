import { NextResponse } from "next/server";
import { connectedAthlete, stravaEnabled } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/strava/status?address=<wallet>  ->  { enabled, athlete }
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!stravaEnabled()) return NextResponse.json({ enabled: false, athlete: null });
  return NextResponse.json({ enabled: true, athlete: address ? await connectedAthlete(address) : null });
}
