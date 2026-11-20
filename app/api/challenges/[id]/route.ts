import { walletSession, walletAuthFailure } from "@/lib/wallet-auth";
import { prepareDeposit } from "@/lib/deposits";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import crypto from "node:crypto";
import { CheckInStatus, MAX_LOGO_BYTES, MAX_PACE_SEC_PER_KM, MAX_PHOTO_BYTES, MAX_SESSION_SEC, MAX_SPONSORS, MIN_PACE_SEC_PER_KM, REVIEW_PACE_SEC_PER_KM, REVIEW_WINDOW_MS, Run, SPONSOR_BONUSES, clean, roomDay, runStatus } from "@/lib/config";
import { payFromEscrow, sponsorAddress, stampProof } from "@/lib/solana-server";
import { computePayouts } from "@/lib/settle";
import { acquireLock, getChallenge, kvGet, kvSet, mutate, newId, releaseLock, savePhoto } from "@/lib/store";

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
 *   (a run counts if distance >= goal and the pace is human; its proof is stamped on Solana)
 *   sponsor { name, amount, url?, logo?, tagline? } -> a brand adds a bonus (locked in escrow); tagline is its ad message
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
      const tagline = clean(body.tagline, 90);
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
        const prepared = await prepareDeposit(c, address, name, { amount, url, logo: logo || undefined, tagline: tagline || undefined });
        return NextResponse.json({ ...prepared, challenge: c });
      });
    }

    // Step 1 of a check-in: the server issues a run session, so the reported time can be checked against its clock.
    if (body.action === "start") {
      const c = await getChallenge(id);
      if (!c) return fail("Challenge not found", 404);
      if (c.status !== "active" || Date.now() >= c.endsAt) return fail("Time's up. This challenge already ended.", 409);
      if (!c.participants.some((x) => x.address === address)) return fail("Join the challenge first.", 403);
      const sessionId = newId() + newId();
      await kvSet(`runsession:${sessionId}`, { challengeId: id, address, startedAt: Date.now() });
      return NextResponse.json({ sessionId, startedAt: Date.now(), roomDay: roomDay(Date.now(), c.timeZone), timeZone: c.timeZone || "UTC" });
    }

    // Step 2: submit the finished session with its photo check-in.
    if (body.action === "run") {
      const km = Math.round(Number(body.km) * 100) / 100;
      const sec = Math.round(Number(body.sec));
      const photo = typeof body.photo === "string" ? body.photo : null;
      if (!photo || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)) return fail("Add your photo check-in.");
      if (photo.length > MAX_PHOTO_BYTES * 1.37) return fail("That photo is too big. Try another one.");
      if (typeof body.sessionId !== "string" || !/^[a-f0-9]{20}$/.test(body.sessionId)) return fail("Start the run in the app before checking in.");
      if (!(km > 0 && km <= 60 && sec > 0 && sec <= MAX_SESSION_SEC)) return fail("That run doesn't look right.");
      const sessionKey = `runsession:${body.sessionId}`;

      const result = await withLock(`c:${id}`, async () => {
        const c = await getChallenge(id);
        if (!c) return { error: fail("Challenge not found", 404) };
        const now = Date.now();
        if (c.status !== "active" || now >= c.endsAt) return { error: fail("Time's up. This challenge already ended.", 409) };
        const p = c.participants.find((x) => x.address === address);
        if (!p) return { error: fail("Join the challenge first.", 403) };
        if (p.runs.length >= 50) return { error: fail("That's a lot of check-ins! Limit reached.") };
        const session = await kvGet<{ challengeId: string; address: string; startedAt: number; used?: boolean }>(sessionKey);
        if (!session || session.challengeId !== id || session.address !== address) return { error: fail("This run session isn't yours or has expired. Start a new run.", 403) };
        if (session.used) return { error: fail("This run was already submitted.", 409) };

        const day = roomDay(session.startedAt, c.timeZone);
        if (p.runs.some((r) => r.roomDay === day && ["approved", "pending"].includes(runStatus(r))))
          return { error: fail(`You already have a check-in for ${day}. Only one counts per room day.`, 409) };

        const paceSec = sec / km;
        const elapsed = (now - session.startedAt) / 1000;
        let status: CheckInStatus = "approved";
        let reason = "";
        if (sec > elapsed + 15) { status = "rejected"; reason = "The reported time is longer than the run session lasted."; }
        else if (km < c.goalKm) { status = "rejected"; reason = `Needs at least ${c.goalKm} km to count.`; }
        else if (paceSec < MIN_PACE_SEC_PER_KM) { status = "rejected"; reason = "Too fast to be running (bike or car?)."; }
        else if (paceSec > MAX_PACE_SEC_PER_KM) { status = "rejected"; reason = "Too slow to count as a run."; }
        else if (paceSec < REVIEW_PACE_SEC_PER_KM) { status = "pending"; reason = "Very fast pace. A reviewer will check this run."; }
        const run: Run = {
          id: newId(), km, sec, at: now, startedAt: session.startedAt, roomDay: day,
          counts: status === "approved", status, reason: reason || undefined, source: "gps", photo: true,
        };
        await savePhoto(run.id, photo);
        await kvSet(sessionKey, { ...session, used: true });
        await mutate(id, (x) => {
          x.participants.find((y) => y.address === p.address)!.runs.push(run);
        });
        return { run, reason };
      });
      if ("error" in result) return result.error!;
      const { run, reason } = result;

      // Stamp the proof on Solana. If the network is slow, the check-in is still saved.
      try {
        const fingerprint = "photo:" + crypto.createHash("sha256").update(photo).digest("hex").slice(0, 32);
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

    // Reviewer decision on a pending check-in. Participants cannot review: only the configured verifier key can.
    if (body.action === "review") {
      const key = process.env.VERIFIER_KEY;
      if (!key) return fail("Review isn't configured on this server.", 501);
      const given = req.headers.get("x-verifier-key") || "";
      if (given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) return fail("Not authorized to review.", 403);
      if (!["approve", "reject"].includes(body.decision)) return fail("Decision must be approve or reject.");
      return await withLock(`c:${id}`, async () => {
        const c = await getChallenge(id);
        if (!c) return fail("Challenge not found", 404);
        if (c.status === "settled" || c.status === "settling") return fail("This challenge is already paying out.", 409);
        const owner = c.participants.find((x) => x.runs.some((r) => r.id === body.runId));
        const run = owner?.runs.find((r) => r.id === body.runId);
        if (!owner || !run || runStatus(run) !== "pending") return fail("No pending check-in with that id.", 404);
        const updated = await mutate(id, (x) => {
          const r = x.participants.find((y) => y.address === owner.address)!.runs.find((y) => y.id === body.runId)!;
          r.status = body.decision === "approve" ? "approved" : "rejected";
          r.counts = r.status === "approved";
          r.reason = clean(body.reason, 140) || (r.counts ? undefined : "Rejected after review.");
        });
        return NextResponse.json({ challenge: updated });
      });
    }

    if (body.action === "settle") {
      const c0 = await getChallenge(id);
      if (!c0) return fail("Challenge not found", 404);
      if (Date.now() < c0.endsAt) return fail("The challenge hasn't ended yet.", 409);
      if (c0.status === "settled") return NextResponse.json({ challenge: c0 });
      // Check-ins under review hold the payout until they are decided or the review window passes.
      const pendingReviews = c0.participants.reduce((n, p) => n + p.runs.filter((r) => runStatus(r) === "pending").length, 0);
      if (pendingReviews > 0 && Date.now() < c0.endsAt + REVIEW_WINDOW_MS)
        return fail(`${pendingReviews} check-in${pendingReviews === 1 ? " is" : "s are"} still under review. The payout opens when they are decided or ${REVIEW_WINDOW_MS / 3600_000} hours after the end.`, 409);

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
