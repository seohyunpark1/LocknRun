import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { MAX_PACE_SEC_PER_KM, MIN_PACE_SEC_PER_KM, clean } from "@/lib/config";
import { lockDeposit, payFromEscrow } from "@/lib/solana-server";
import { computePayouts } from "@/lib/settle";
import { getChallenge, mutate, newId } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settlingNow = new Set<string>(); // in-process lock so a challenge is never paid out twice

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const c = getChallenge(params.id);
  if (!c) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  return NextResponse.json({ challenge: c });
}

/**
 * POST /api/challenges/:id { action, ... }
 *   join   { name, address }     -> lock the deposit in escrow, add runner
 *   run    { address, km, sec }  -> log a run (counts if distance >= goal and pace is human)
 *   settle {}                    -> after the deadline: pay finishers from escrow
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const c = getChallenge(params.id);
  if (!c) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
  const now = Date.now();

  try {
    if (body.action === "join") {
      if (c.status !== "active" || now >= c.endsAt) return fail("This challenge already ended.", 409);
      try {
        new PublicKey(body.address);
      } catch {
        return fail("Missing your wallet. Refresh the page.");
      }
      if (c.participants.some((p) => p.address === body.address)) return fail("You're already in!", 409);
      const joinSig = await lockDeposit(c.id, c.deposit);
      const updated = mutate(c.id, (x) => {
        x.participants.push({ name: clean(body.name, 24, "Runner"), address: String(body.address), joinedAt: now, joinSig, runs: [] });
      });
      return NextResponse.json({ challenge: updated });
    }

    if (body.action === "run") {
      if (c.status !== "active" || now >= c.endsAt) return fail("Time's up. This challenge already ended.", 409);
      const p = c.participants.find((x) => x.address === body.address);
      if (!p) return fail("Join the challenge first.", 403);
      const km = Math.round(Number(body.km) * 100) / 100;
      const sec = Math.round(Number(body.sec));
      if (!(km > 0 && km <= 60 && sec > 0 && sec <= 6 * 3600)) return fail("That run doesn't look right.");
      if (p.runs.length >= 50) return fail("That's a lot of runs! Limit reached.");

      const paceSec = sec / km;
      let reason = "";
      if (km < c.goalKm) reason = `Needs at least ${c.goalKm} km to count.`;
      else if (paceSec < MIN_PACE_SEC_PER_KM) reason = "Too fast to be running (bike or car?).";
      else if (paceSec > MAX_PACE_SEC_PER_KM) reason = "Too slow to count as a run.";
      const run = { id: newId(), km, sec, at: now, counts: !reason };

      const updated = mutate(c.id, (x) => {
        x.participants.find((y) => y.address === p.address)!.runs.push(run);
      });
      return NextResponse.json({ challenge: updated, run, reason });
    }

    if (body.action === "settle") {
      if (now < c.endsAt) return fail("The challenge hasn't ended yet.", 409);
      if (c.status === "settled") return NextResponse.json({ challenge: c });
      if (settlingNow.has(c.id)) return fail("Already paying out, hang on…", 409);
      settlingNow.add(c.id);
      try {
        mutate(c.id, (x) => {
          x.status = "settling";
        });
        const { payouts } = computePayouts(c);
        for (const po of payouts) {
          const fresh = getChallenge(c.id)!;
          const p = fresh.participants.find((x) => x.address === po.address)!;
          if (p.paySig || po.amount <= 0) {
            mutate(c.id, (x) => {
              x.participants.find((y) => y.address === po.address)!.payout = po.amount;
            });
            continue; // already paid (retry) or nothing to pay
          }
          const sig = await payFromEscrow(c.id, po.address, po.amount);
          mutate(c.id, (x) => {
            const y = x.participants.find((z) => z.address === po.address)!;
            y.payout = po.amount;
            y.paySig = sig;
          });
        }
        const updated = mutate(c.id, (x) => {
          x.status = "settled";
          x.settledAt = Date.now();
        });
        return NextResponse.json({ challenge: updated });
      } finally {
        settlingNow.delete(c.id);
      }
    }

    return fail("Unknown action");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong";
    console.error(`challenge ${params.id}:`, msg);
    return fail(msg, 500);
  }
}
