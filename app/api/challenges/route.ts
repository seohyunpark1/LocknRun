import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { Challenge, DURATION_LIMITS, RANGES, clean } from "@/lib/config";
import { escrowAddress, escrowBalance, lockDeposit } from "@/lib/solana-server";
import { insertChallenge, listChallenges, newId } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/challenges -> all challenges + the escrow wallet's live USDC balance on Solana.
export async function GET() {
  return NextResponse.json({
    challenges: await listChallenges(),
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
    const goalKm = Math.round(Number(b.goalKm) * 10) / 10;
    const runsRequired = Number(b.runsRequired);
    const deposit = Number(b.deposit);
    const minutes = Number(b.minutes);
    const inRange = (v: number, r: { min: number; max: number }) => isFinite(v) && v >= r.min && v <= r.max;
    if (!inRange(goalKm, RANGES.goalKm)) return NextResponse.json({ error: "Distance must be 0.5–42.2 km." }, { status: 400 });
    if (!Number.isInteger(runsRequired) || !inRange(runsRequired, RANGES.runs))
      return NextResponse.json({ error: "Runs must be a whole number from 1 to 30." }, { status: 400 });
    if (!Number.isInteger(deposit) || !inRange(deposit, RANGES.deposit))
      return NextResponse.json({ error: "Deposit must be a whole dollar amount from $1 to $100." }, { status: 400 });
    if (!Number.isInteger(minutes) || !inRange(minutes, DURATION_LIMITS))
      return NextResponse.json({ error: "Pick how long the challenge lasts (5 minutes to 6 months)." }, { status: 400 });
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
    await insertChallenge(c);
    return NextResponse.json({ challenge: c });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create challenge";
    console.error("create challenge:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
