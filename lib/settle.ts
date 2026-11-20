// Settlement math (pure, no I/O). Rules follow LocknRun_Basic_Structure.md, section 6.
// All arithmetic is in integer micro-USDC (6 decimals), so the UI and payouts always agree.
import { Challenge, Participant, bonusOf, countedRuns, isFinisher, rewardModeOf } from "./config";

/** Platform fee: 5% of forfeited participant stakes, rounded down. */
export const PLATFORM_FEE_RATE = 0.05;
const UNIT = 1_000_000;
const micro = (usdc: number) => Math.round(usdc * UNIT);

/** pool mode: finished | forfeited | refund. fraction mode: finished (100%) | safe (85–99%) | partial (below 85%) | refund. */
export type Tier = "finished" | "forfeited" | "refund" | "safe" | "partial";
export const SAFE_RATE = 0.85; // fraction mode: 85%+ gets the full stake back
export type Payout = { address: string; name: string; amount: number; finisher: boolean; tier: Tier; rate: number };

/** Share of required qualifying runs completed, 0 to 1. */
export function achievement(c: Challenge, p: Participant) {
  return Math.min(countedRuns(p), c.runsRequired) / c.runsRequired;
}

type Result = {
  payouts: Payout[];
  pot: number;
  fee: number;
  leftover: number;
  sponsorRefund: number;
  prizePerWinner: number;
};

/** The creator picks the reward mode when the challenge is created. */
export function computePayouts(c: Challenge): Result {
  return rewardModeOf(c) === "fraction" ? computeFractionPayouts(c) : computePoolPayouts(c);
}

/**
 * Fraction mode (Challengers-style). Everyone stakes D; sponsors may add B.
 * - 100% of runs ("finished"): D back + an equal share of the prize pool.
 * - 85–99% ("safe"): D back.
 * - Below 85% ("partial"): D × completion rate back; the rest goes into the prize pool.
 * Prize pool = everything partial runners didn't get back + B. If nobody reaches 100%, everyone gets D back and B returns
 * to the sponsors. Whole cents, rounded down; leftover cents stay in escrow. No platform fee in this mode.
 */
function computeFractionPayouts(c: Challenge): Result {
  const D = Math.round(c.deposit * 100);
  const bonus = bonusOf(c);
  const pot = c.participants.length * c.deposit + bonus;
  const rows = c.participants.map((p) => {
    const rate = achievement(c, p);
    return { p, rate, tier: (rate >= 1 ? "finished" : rate >= SAFE_RATE ? "safe" : "partial") as Tier };
  });
  const winners = rows.filter((r) => r.tier === "finished").length;
  if (winners === 0) {
    const payouts = rows.map(({ p, rate }) => ({ address: p.address, name: p.name, amount: c.deposit, finisher: false, tier: "refund" as Tier, rate }));
    return { payouts, pot, fee: 0, leftover: 0, sponsorRefund: bonus, prizePerWinner: 0 };
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
    address: p.address, name: p.name,
    amount: (backCents[i] + (tier === "finished" ? shareCents : 0)) / 100,
    finisher: tier === "finished", tier, rate,
  }));
  const paid = payouts.reduce((sum, x) => sum + Math.round(x.amount * 100), 0);
  return { payouts, pot, fee: 0, leftover: (Math.round(pot * 100) - paid) / 100, sponsorRefund: 0, prizePerWinner: shareCents / 100 };
}

/**
 * Pool mode (all-or-nothing). N funded participants stake D each, W finish, sponsors add B.
 * - Forfeited stakes F = (N − W) × D. Platform fee = 5% of F.
 * - W > 0: finishers share N × D + B − fee equally; leftover micro-units go to finishers in join order.
 * - W = 0: every stake is refunded and sponsor bonuses are returned (nobody to pay, no fee).
 */
function computePoolPayouts(c: Challenge): Result {
  const D = micro(c.deposit);
  const B = micro(bonusOf(c));
  const N = c.participants.length;
  const pot = (N * D + B) / UNIT;
  const rows = c.participants.map((p) => ({ p, rate: achievement(c, p), done: isFinisher(c, p) }));
  const W = rows.filter((r) => r.done).length;

  if (W === 0) {
    const payouts = rows.map(({ p, rate }) => ({ address: p.address, name: p.name, amount: c.deposit, finisher: false, tier: "refund" as Tier, rate }));
    return { payouts, pot, fee: 0, leftover: 0, sponsorRefund: B / UNIT, prizePerWinner: 0 };
  }

  const forfeited = (N - W) * D;
  const fee = Math.floor(forfeited * PLATFORM_FEE_RATE);
  const distributable = N * D + B - fee;
  const share = Math.floor(distributable / W);
  let extra = distributable - share * W; // leftover micro-units, handed out in join order

  const payouts = rows.map(({ p, rate, done }) => {
    let amount = 0;
    if (done) {
      amount = share + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
    }
    return { address: p.address, name: p.name, amount: amount / UNIT, finisher: done, tier: (done ? "finished" : "forfeited") as Tier, rate };
  });
  return { payouts, pot, fee: fee / UNIT, leftover: 0, sponsorRefund: 0, prizePerWinner: Math.max(0, share - D) / UNIT };
}

/** For a finisher: how the winnings above the stake split into other runners' forfeits vs. sponsor bonus. */
export function prizeBreakdown(c: Challenge) {
  const { prizePerWinner, payouts } = computePayouts(c);
  const W = payouts.filter((p) => p.finisher).length || 1;
  const bonusShare = Math.min(prizePerWinner, Math.floor(micro(bonusOf(c)) / W) / UNIT);
  return { fromOthers: Math.max(0, Math.round((prizePerWinner - bonusShare) * UNIT) / UNIT), bonusShare };
}
