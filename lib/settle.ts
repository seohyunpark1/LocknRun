// Settlement math (pure, no I/O, easy to test and explain to judges).
// Rewards work like Challengers: what you get back depends on your achievement rate.
import { Challenge, Participant, bonusOf, countedRuns } from "./config";

export const SAFE_RATE = 0.85; // 85%+ gets the full deposit back

export type Tier = "full" | "safe" | "partial";
export type Payout = { address: string; name: string; amount: number; finisher: boolean; tier: Tier; rate: number };

/** Share of required runs completed, 0 to 1. */
export function achievement(c: Challenge, p: Participant) {
  return Math.min(countedRuns(p), c.runsRequired) / c.runsRequired;
}

export function tierOf(rate: number): Tier {
  return rate >= 1 ? "full" : rate >= SAFE_RATE ? "safe" : "partial";
}

/**
 * Everyone puts in the same deposit D. Sponsors may add a bonus B.
 * - 100% achievers ("full"): D back + an equal share of the prize pool.
 * - 85–99% ("safe"): D back.
 * - Below 85% ("partial"): D × achievement rate back; the rest goes into the prize pool.
 * Prize pool = everything the partial achievers didn't get back + B.
 * If nobody reaches 100%, there's no one to win the prize: everyone gets D back and B returns to the sponsors.
 * All amounts are in whole cents, rounded down; leftover cents stay in escrow.
 */
export function computePayouts(c: Challenge): {
  payouts: Payout[];
  pot: number;
  leftover: number;
  sponsorRefund: number;
  prizePerWinner: number;
} {
  const D = Math.round(c.deposit * 100);
  const bonus = bonusOf(c);
  const pot = c.participants.length * c.deposit + bonus;
  const rows = c.participants.map((p) => {
    const rate = achievement(c, p);
    return { p, rate, tier: tierOf(rate) };
  });
  const winners = rows.filter((r) => r.tier === "full").length;

  if (winners === 0) {
    const payouts = rows.map(({ p, rate, tier }) => ({ address: p.address, name: p.name, amount: c.deposit, finisher: false, tier, rate }));
    return { payouts, pot, leftover: 0, sponsorRefund: bonus, prizePerWinner: 0 };
  }

  let prizeCents = Math.round(bonus * 100);
  const backCents = rows.map(({ rate, tier }) => {
    if (tier !== "partial") return D;
    const back = Math.floor(D * rate);
    prizeCents += D - back;
    return back;
  });
  const shareCents = Math.floor(prizeCents / winners);

  const payouts = rows.map(({ p, rate, tier }, i) => ({
    address: p.address,
    name: p.name,
    amount: (backCents[i] + (tier === "full" ? shareCents : 0)) / 100,
    finisher: tier === "full",
    tier,
    rate,
  }));
  const paid = payouts.reduce((s, x) => s + Math.round(x.amount * 100), 0);
  return { payouts, pot, leftover: (Math.round(pot * 100) - paid) / 100, sponsorRefund: 0, prizePerWinner: shareCents / 100 };
}

/** For a 100% achiever: how their prize splits into other runners' forfeits vs. sponsor bonus. */
export function prizeBreakdown(c: Challenge) {
  const { prizePerWinner, payouts } = computePayouts(c);
  const winners = payouts.filter((p) => p.tier === "full").length || 1;
  const bonusShare = Math.floor((bonusOf(c) * 100) / winners) / 100;
  return { fromOthers: Math.max(0, Math.round((prizePerWinner - bonusShare) * 100) / 100), bonusShare: Math.min(bonusShare, prizePerWinner) };
}
