import { NextResponse } from "next/server";
import { walletSession, walletAuthFailure } from "@/lib/wallet-auth";
import { acquireLock, getChallenge, kvGet, kvSet, releaseLock } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheers (👏) on check-ins, Challengers-style. Stored per challenge: { [runId]: [wallet addresses] }.
type Cheers = Record<string, string[]>;
const key = (id: string) => `cheers:${id}`;
const validId = (s: unknown) => typeof s === "string" && /^[a-f0-9]{10}$/.test(s);

// GET /api/cheers?challenge=<id>  ->  { counts: { runId: n }, mine: [runId] }
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("challenge");
  if (!validId(id)) return NextResponse.json({ error: "Invalid challenge" }, { status: 400 });
  const [all, me] = await Promise.all([kvGet<Cheers>(key(id!)), walletSession(req)]);
  const cheers = all || {};
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const [runId, who] of Object.entries(cheers)) {
    counts[runId] = who.length;
    if (me && who.includes(me)) mine.push(runId);
  }
  return NextResponse.json({ counts, mine });
}

// POST /api/cheers { challengeId, runId }  ->  toggles your cheer on that check-in (wallet sign-in required)
export async function POST(req: Request) {
  const address = await walletSession(req);
  if (!address) return walletAuthFailure();
  const b = await req.json().catch(() => ({}));
  if (!validId(b.challengeId) || !validId(b.runId)) return NextResponse.json({ error: "Invalid check-in" }, { status: 400 });
  const c = await getChallenge(b.challengeId);
  const run = c?.participants.flatMap((p) => p.runs.map((r) => ({ r, owner: p.address }))).find((x) => x.r.id === b.runId);
  if (!c || !run) return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  if (run.owner === address) return NextResponse.json({ error: "You can't cheer your own check-in." }, { status: 400 });

  const lock = await acquireLock(key(c.id), 10);
  if (!lock) return NextResponse.json({ error: "Busy, try again." }, { status: 409 });
  try {
    const cheers = (await kvGet<Cheers>(key(c.id))) || {};
    const who = cheers[b.runId] || [];
    const on = !who.includes(address);
    cheers[b.runId] = on ? [...who, address].slice(-500) : who.filter((a) => a !== address);
    await kvSet(key(c.id), cheers);
    return NextResponse.json({ on, count: cheers[b.runId].length });
  } finally {
    await releaseLock(key(c.id), lock);
  }
}
