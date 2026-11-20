import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { Challenge, DEPOSITS, DURATIONS, GOAL_KMS, RUNS_REQUIRED, clean } from "@/lib/config";
import { escrowAddress, escrowBalance, lockDeposit } from "@/lib/solana-server";
import { insertChallenge, listChallenges, newId } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/challenges -> all challenges + the escrow wallet's live USDC balance on Solana.
export async function GET() {
  return NextResponse.json({
    challenges: listChallenges(),
    escrow: { address: escrowAddress(), balance: await escrowBalance() },
  });
}

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

// POST /api/challenges -> create a challenge; the creator joins and their deposit is locked in escrow.
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const goalKm = Number(b.goalKm);
    const runsRequired = Number(b.runsRequired);
    const deposit = Number(b.deposit);
    const minutes = Number(b.minutes);
    if (!GOAL_KMS.includes(goalKm) || !RUNS_REQUIRED.includes(runsRequired) || !DEPOSITS.includes(deposit))
      return NextResponse.json({ error: "Pick the challenge options." }, { status: 400 });
    if (!DURATIONS.some((d) => d.minutes === minutes))
      return NextResponse.json({ error: "Pick how long the challenge lasts." }, { status: 400 });
    try {
      new PublicKey(b.address);
    } catch {
      return NextResponse.json({ error: "Missing your wallet. Refresh the page." }, { status: 400 });
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
    if (limited(ip)) return NextResponse.json({ error: "Slow down a little!" }, { status: 429 });

    const name = clean(b.name, 24, "Runner");
    const id = newId();
    const joinSig = await lockDeposit(id, deposit); // money first: no deposit, no challenge

    const now = Date.now();
    const c: Challenge = {
      id,
      title: clean(b.title, 60, `${runsRequired}× ${goalKm} km`),
      goalKm,
      runsRequired,
      deposit,
      createdAt: now,
      endsAt: now + minutes * 60_000,
      creatorName: name,
      status: "active",
      participants: [{ name, address: String(b.address), joinedAt: now, joinSig, runs: [] }],
    };
    insertChallenge(c);
    return NextResponse.json({ challenge: c });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create challenge";
    console.error("create challenge:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
