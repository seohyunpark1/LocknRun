// Settlement math (pure, no I/O). Rules follow LocknRun_Basic_Structure.md, section 6.
// All arithmetic is in integer micro-USDC (6 decimals), so the UI and payouts always agree.
import { Challenge, Participant, bonusOf, countedRuns, isFinisher } from "./config";

/** Platform fee: 5% of forfeited participant stakes, rounded down. */
export const PLATFORM_FEE_RATE = 0.05;
const UNIT = 1_000_000;
const micro = (usdc: number) => Math.round(usdc * UNIT);

export type Tier = "finished" | "forfeited" | "refund";
export type Payout = { address: string; name: string; amount: number; finisher: boolean; tier: Tier; rate: number };

/** Share of required qualifying runs completed, 0 to 1. */
export function achievement(c: Challenge, p: Participant) {
  return Math.min(countedRuns(p), c.runsRequired) / c.runsRequired;
}

/**
 * N funded participants stake D each, W finish, sponsors add B.
 * - Forfeited stakes F = (N − W) × D. Platform fee = 5% of F.
 * - W > 0: finishers share N × D + B − fee equally; leftover micro-units go to finishers in join order.
 * - W = 0: every stake is refunded and sponsor bonuses are returned (nobody to pay, no fee).
 */
export function computePayouts(c: Challenge): {
  payouts: Payout[];
  pot: number;
  fee: number;
  leftover: number;
  sponsorRefund: number;
  prizePerWinner: number;
} {
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
