import { walletSession, walletAuthFailure } from "@/lib/wallet-auth";
import { prepareDeposit } from "@/lib/deposits";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { newInviteCode, canView, viewFor } from "@/lib/access";
import { Challenge, DURATION_LIMITS, RANGES, clean, roomDaysIn, validTimeZone } from "@/lib/config";
import { escrowAddress, escrowBalance } from "@/lib/solana-server";
import { insertChallenge, listChallenges, newId } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/challenges -> all challenges + the escrow wallet's live USDC balance on Solana.
export async function GET(req: Request) {
  const me = await walletSession(req); // private challenges are listed only to their participants
  return NextResponse.json({
    challenges: (await listChallenges()).filter(c => c.status !== "draft" && canView(c, me)).map(c => viewFor(c, me)),
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
    const address = await walletSession(req);
    if (!address) return walletAuthFailure();
    const b = await req.json();
    b.address = address;
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


    const now = Date.now();
    const timeZone = validTimeZone(b.timeZone) ? b.timeZone : "UTC";
    const days = roomDaysIn({ createdAt: now, endsAt: now + minutes * 60_000, timeZone });
    // One qualifying check-in counts per room day, so the goal can't need more days than the challenge has.
    if (runsRequired > days) return NextResponse.json({ error: `Only one run counts per day, and this challenge spans ${days} day${days === 1 ? "" : "s"}. Lower the number of runs or make it longer.` }, { status: 400 });
    const c: Challenge = {
      id,
      title: clean(b.title, 60, `${runsRequired}× ${goalKm} km`),
      goalKm,
      runsRequired,
      deposit,
      createdAt: now,
      endsAt: now + minutes * 60_000,
      creatorName: name,
      timeZone,
      ...(process.env.ESCROW_MODE === "program" ? { escrow: "program" as const } : {}),
      rewardMode: b.rewardMode === "fraction" ? "fraction" : "pool",
      visibility: b.visibility === "private" ? "private" : "public",
      ...(b.visibility === "private" ? { inviteCode: newInviteCode() } : {}),
      status: "draft",
      participants: [],
    };
    const prepared = await prepareDeposit(c, address, name);
    await insertChallenge(c);
    return NextResponse.json({ ...prepared, challenge: c });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create challenge";
    console.error("create challenge:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
