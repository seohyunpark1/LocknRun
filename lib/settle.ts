// Settlement math (pure, no I/O, easy to test and explain to judges).
import { Challenge, isFinisher } from "./config";

export type Payout = { address: string; name: string; amount: number; finisher: boolean };

/**
 * Everyone puts in the same deposit.
 * - Finishers get their deposit back plus an equal share of the non-finishers' deposits.
 * - Non-finishers get nothing back.
 * - If nobody finishes, everyone is refunded (no winners to pay).
 * Shares are rounded DOWN to the cent; leftover cents stay in escrow.
 */
export function computePayouts(c: Challenge): { payouts: Payout[]; pot: number; leftover: number } {
  const pot = c.participants.length * c.deposit;
  const finishers = c.participants.filter((p) => isFinisher(c, p));
  const quitters = c.participants.length - finishers.length;

  if (finishers.length === 0) {
    const payouts = c.participants.map((p) => ({ address: p.address, name: p.name, amount: c.deposit, finisher: false }));
    return { payouts, pot, leftover: 0 };
  }

  const bonusCents = Math.floor((quitters * c.deposit * 100) / finishers.length);
  const each = c.deposit + bonusCents / 100;
  const payouts = c.participants.map((p) => {
    const fin = isFinisher(c, p);
    return { address: p.address, name: p.name, amount: fin ? each : 0, finisher: fin };
  });
  const paid = payouts.reduce((s, p) => s + p.amount, 0);
  return { payouts, pot, leftover: Math.round((pot - paid) * 100) / 100 };
}
