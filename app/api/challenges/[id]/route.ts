import { walletSession, walletAuthFailure } from "@/lib/wallet-auth";
import { prepareDeposit } from "@/lib/deposits";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import crypto from "node:crypto";
import { MAX_LOGO_BYTES, MAX_PACE_SEC_PER_KM, MAX_PHOTO_BYTES, MAX_SPONSORS, MIN_PACE_SEC_PER_KM, Run, SPONSOR_BONUSES, clean } from "@/lib/config";
import { payFromEscrow, sponsorAddress, stampProof } from "@/lib/solana-server";
import { computePayouts } from "@/lib/settle";
import { acquireLock, getChallenge, kvSet, mutate, newId, releaseLock, savePhoto } from "@/lib/store";
import { StravaRun, getRun, stravaEnabled } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // payouts send several Solana transactions

/** Run `fn` while holding a per-challenge lock, so concurrent writes don't overwrite each other. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 40; i++) {
    const token = await acquireLock(key, 120);
    if (token) {
      try {
        return await fn();
      } finally {
        await releaseLock(key, token);
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Busy right now, try again in a moment.");
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const c = await getChallenge(params.id);
  if (!c) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  return NextResponse.json({ challenge: c });
}

/**
 * POST /api/challenges/:id { action, ... }
 *   join   { name, address }     -> lock the deposit in escrow, add runner
 *   run    { address, km, sec, photo } -> log a GPS run with a photo proof
 *   strava { address, activityId }      -> import a run from Strava (verified with Strava's API)
 *   (a run counts if distance >= goal and the pace is human; its proof is stamped on Solana)
 *   sponsor { name, amount, url?, logo? } -> a brand adds a bonus to the pot (locked in escrow)
 *   settle {}                    -> after the deadline: pay finishers from escrow
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
  const id = params.id;

  try {
    const address = await walletSession(req);
    if (!address) return walletAuthFailure();
    body.address = address;
    if (body.action === "join") {
      try {
        new PublicKey(body.address);
      } catch {
        return fail("Missing your wallet. Refresh the page.");
      }
      return await withLock(`c:${id}`, async () => {
        const c = await getChallenge(id);
        if (!c) return fail("Challenge not found", 404);
        const now = Date.now();
        if (c.status !== "active" || now >= c.endsAt) return fail("This challenge already ended.", 409);
        if (c.participants.some((p) => p.address === body.address)) return fail("You're already in!", 409);
        const prepared = await prepareDeposit(c, address, clean(body.name, 24, "Runner"));
        return NextResponse.json({ ...prepared, challenge: c });
      });
    }

    if (body.action === "sponsor") {
      const name = clean(body.name, 40);
      const amount = Number(body.amount);
      const url = typeof body.url === "string" && /^https:\/\/[^\s]{3,200}$/.test(body.url.trim()) ? body.url.trim() : undefined;
      const logo = typeof body.logo === "string" && body.logo ? body.logo : null;
      if (logo && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > MAX_LOGO_BYTES * 1.37))
        return fail("Logo must be a PNG or JPG under 150 KB.");
      if (!name) return fail("Add the sponsor's name.");
      if (!SPONSOR_BONUSES.includes(amount)) return fail("Pick a bonus amount.");
      return await withLock(`c:${id}`, async () => {
        const c = await getChallenge(id);
        if (!c) return fail("Challenge not found", 404);
        if (c.status !== "active" || Date.now() >= c.endsAt) return fail("This challenge already ended.", 409);
        if ((c.sponsors || []).length >= MAX_SPONSORS) return fail("This challenge already has the maximum number of sponsors.", 409);
        const prepared = await prepareDeposit(c, address, name, { amount, url, logo: logo || undefined });
        return NextResponse.json({ ...prepared, challenge: c });
      });
    }

    if (body.action === "run" || body.action === "strava") {
      // Gather the proof first (outside the lock: these can take a few seconds).
      let km: number, sec: number, photo: string | null = null, strava: StravaRun | null = null;
      if (body.action === "run") {
        km = Math.round(Number(body.km) * 100) / 100;
        sec = Math.round(Number(body.sec));
        photo = typeof body.photo === "string" ? body.photo : null;
        if (!photo || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)) return fail("Add a photo as proof of your run.");
        if (photo.length > MAX_PHOTO_BYTES * 1.37) return fail("That photo is too big. Try another one.");
      } else {
        if (!stravaEnabled()) return fail("Strava isn't set up on this server.", 501);
        strava = await getRun(String(body.address), Number(body.activityId));
        if (!strava) return fail("That Strava activity isn't a run.");
        km = strava.km;
        sec = strava.sec;
      }
      if (!(km > 0 && km <= 60 && sec > 0 && sec <= 6 * 3600)) return fail("That run doesn't look right.");

      const result = await withLock(`c:${id}`, async () => {
        const c = await getChallenge(id);
        if (!c) return { error: fail("Challenge not found", 404) };
        const now = Date.now();
        if (c.status !== "active" || now >= c.endsAt) return { error: fail("Time's up. This challenge already ended.", 409) };
        const p = c.participants.find((x) => x.address === body.address);
        if (!p) return { error: fail("Join the challenge first.", 403) };
        if (p.runs.length >= 50) return { error: fail("That's a lot of runs! Limit reached.") };
        if (strava) {
          if (c.participants.some((x) => x.runs.some((r) => r.stravaId === strava!.id)))
            return { error: fail("That Strava run was already used.", 409) };
          if (strava.startedAt < p.joinedAt || strava.startedAt > c.endsAt)
            return { error: fail("That run happened outside this challenge.", 409) };
        }

        const paceSec = sec / km;
        let reason = "";
        if (km < c.goalKm) reason = `Needs at least ${c.goalKm} km to count.`;
        else if (paceSec < MIN_PACE_SEC_PER_KM) reason = "Too fast to be running (bike or car?).";
        else if (paceSec > MAX_PACE_SEC_PER_KM) reason = "Too slow to count as a run.";
        const run: Run = {
          id: newId(),
          km,
          sec,
          at: now,
          counts: !reason,
          source: strava ? "strava" : "gps",
          photo: !!photo,
          ...(strava ? { stravaId: strava.id, stravaName: strava.name } : {}),
        };
        if (photo) await savePhoto(run.id, photo);
        await mutate(id, (x) => {
          x.participants.find((y) => y.address === p.address)!.runs.push(run);
        });
        return { run, reason };
      });
      if ("error" in result) return result.error!;
      const { run, reason } = result;

      // Stamp the proof on Solana. If the network is slow, the run is still saved.
      const fingerprint = photo
        ? "photo:" + crypto.createHash("sha256").update(photo).digest("hex").slice(0, 32)
        : `strava:${run.stravaId}`;
      try {
        const proofSig = await stampProof(`LockRun|run|${id}|${run.km}km|${run.sec}s|${fingerprint}`);
        await withLock(`c:${id}`, () => mutate(id, (x) => {
          const r = x.participants.flatMap((y) => y.runs).find((y) => y.id === run.id);
          if (r) r.proofSig = proofSig;
        }));
        run.proofSig = proofSig;
      } catch (e) {
        console.error("proof stamp failed:", e instanceof Error ? e.message : e);
      }
      return NextResponse.json({ challenge: await getChallenge(id), run, reason });
    }

    if (body.action === "settle") {
      const c0 = await getChallenge(id);
      if (!c0) return fail("Challenge not found", 404);
      if (Date.now() < c0.endsAt) return fail("The challenge hasn't ended yet.", 409);
      if (c0.status === "settled") return NextResponse.json({ challenge: c0 });

      // Separate long-lived lock so a challenge is never paid out twice.
      const settlementLock = await acquireLock(`c:${id}`, 300);
      if (!settlementLock) return fail("Already paying out, hang on…", 409);
      try {
        const latest = await getChallenge(id);
        if (latest?.pendingDeposits?.length) return fail("Confirm pending deposits before settlement.", 409);
        const c = (await mutate(id, (x) => {
          if (x.status === "active") x.status = "settling";
        }))!;
        if (c.status === "settled") return NextResponse.json({ challenge: c });

        const { payouts } = computePayouts(c);
        for (const po of payouts) {
          const fresh = (await getChallenge(id))!;
          const p = fresh.participants.find((x) => x.address === po.address)!;
          if (p.paySig || po.amount <= 0) {
            await mutate(id, (x) => {
              x.participants.find((y) => y.address === po.address)!.payout = po.amount;
            });
            continue; // already paid (retry) or nothing to pay
          }
          const sig = await payFromEscrow(id, po.address, po.amount);
          await mutate(id, (x) => {
            const y = x.participants.find((z) => z.address === po.address)!;
            y.payout = po.amount;
            y.paySig = sig;
          });
        }
        const { sponsorRefund } = computePayouts(c);
        if (sponsorRefund > 0 && !c.sponsorRefundSig) {
          for (let i = 0; i < (c.sponsors || []).length; i++) {
            const entry = (await getChallenge(id))!.sponsors![i];
            if (entry.refundSig) continue;
            const to = entry.address || sponsorAddress();
            // Include the funding signature so refunds cannot collide with runner payouts or each other.
            const sig = await payFromEscrow(`${id}:${entry.sig}`, to, entry.amount, "sponsor-refund");
            await mutate(id, x => { x.sponsors![i].refundSig = sig; });
          }
          await mutate(id, x => { x.sponsorRefundSig = x.sponsors?.[0]?.refundSig; });
        }
        const updated = await mutate(id, (x) => {
          x.status = "settled";
          x.settledAt = Date.now();
        });
        return NextResponse.json({ challenge: updated });
      } finally {
        await releaseLock(`c:${id}`, settlementLock);
      }
    }

    return fail("Unknown action");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong";
    console.error(`challenge ${id}:`, msg);
    return fail(msg, 500);
  }
}
