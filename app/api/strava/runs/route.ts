import { NextResponse } from "next/server";
import { getChallenge } from "@/lib/store";
import { listRuns } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/strava/runs?address=<wallet>&challenge=<id>  ->  the runner's Strava runs since they joined
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address") || "";
  const c = await getChallenge(url.searchParams.get("challenge") || "");
  const p = c?.participants.find((x) => x.address === address);
  if (!c || !p) return NextResponse.json({ error: "Join the challenge first." }, { status: 403 });
  try {
    const used = new Set(c.participants.flatMap((x) => x.runs.map((r) => r.stravaId)).filter(Boolean));
    const runs = (await listRuns(address, p.joinedAt)).filter((r) => r.startedAt <= c.endsAt).map((r) => ({ ...r, used: used.has(r.id) }));
    return NextResponse.json({ runs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Strava error", runs: [] }, { status: 502 });
  }
}
