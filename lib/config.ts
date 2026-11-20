// Shared settings and types, safe in the browser and on the server.

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
export const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

// Challenge options (server only accepts these).
export const DEPOSITS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50];
export const GOAL_KMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 21];
export const RUNS_REQUIRED = [1, 2, 3, 4, 5, 6, 7];
// "Ends in": pick a unit, then turn the dial for the number.
export const DURATION_UNITS = [
  { key: "min", label: "Min", minutes: 1, values: [5, 10, 15, 20, 30, 45] },
  { key: "hour", label: "Hour", minutes: 60, values: [1, 2, 3, 4, 5, 6, 8, 10, 12, 18] },
  { key: "day", label: "Day", minutes: 1440, values: [1, 2, 3, 4, 5, 6] },
  { key: "week", label: "Week", minutes: 10080, values: [1, 2, 3, 4] },
  { key: "month", label: "Month", minutes: 43200, values: [1, 2, 3, 4, 5, 6] }, // 1 month = 30 days
] as const;

/** Every duration (in minutes) the server accepts. */
export const DURATIONS: number[] = DURATION_UNITS.flatMap((u) => u.values.map((v) => v * u.minutes));

/** Full label: 15 min, 2 hours, 3 days, 1 week, 2 months */
export function durationLabel(min: number) {
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (min % 43200 === 0) return unit(min / 43200, "month");
  if (min % 10080 === 0) return unit(min / 10080, "week");
  if (min % 1440 === 0) return unit(min / 1440, "day");
  if (min % 60 === 0) return unit(min / 60, "hour");
  return `${min} min`;
}

// Anti-cheat sanity limits for a submitted run.
export const MIN_PACE_SEC_PER_KM = 150; // faster than 2:30/km = probably a bike or car
export const MAX_PACE_SEC_PER_KM = 1200; // slower than 20:00/km = walking around, doesn't count

export type Run = {
  id: string;
  km: number;
  sec: number;
  at: number;
  counts: boolean;
  source?: "gps" | "strava";
  photo?: boolean; // a photo proof is stored for this run (GET /api/photos/<run id>)
  stravaId?: number; // Strava activity id, for imported runs
  stravaName?: string;
  proofSig?: string; // Solana memo transaction that stamps the proof on-chain
};

// Biggest photo the server accepts after in-browser compression (~0.45 MB).
export const MAX_PHOTO_BYTES = 450_000;

export type Participant = {
  name: string;
  address: string;
  joinedAt: number;
  joinSig: string; // deposit locked in escrow
  runs: Run[];
  payout?: number; // set at settlement
  paySig?: string; // escrow -> runner
};

export type ChallengeStatus = "active" | "settling" | "settled";

/** A brand that added bonus money to a challenge's pot (split among finishers). */
export type Sponsor = { name: string; amount: number; url?: string; at: number; sig: string };
export const SPONSOR_BONUSES = [10, 25, 50, 100];
export const MAX_SPONSORS = 3;

export type Challenge = {
  id: string;
  title: string;
  goalKm: number;
  runsRequired: number;
  deposit: number;
  createdAt: number;
  endsAt: number;
  creatorName: string;
  status: ChallengeStatus;
  participants: Participant[];
  sponsors?: Sponsor[];
  sponsorRefundSig?: string; // bonus returned to sponsors when nobody finished
  settledAt?: number;
};

export const bonusOf = (c: Challenge) => (c.sponsors || []).reduce((s, x) => s + x.amount, 0);
export const potOf = (c: Challenge) => c.deposit * c.participants.length + bonusOf(c);

export function countedRuns(p: Participant) {
  return p.runs.filter((r) => r.counts).length;
}

export function isFinisher(c: Challenge, p: Participant) {
  return countedRuns(p) >= c.runsRequired;
}

export function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function explorerAddress(addr: string) {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

export function clean(raw: unknown, max: number, fallback = ""): string {
  const s = String(raw ?? "")
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}$]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || fallback;
}

export function money(n: number) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function pace(secPerKm: number) {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "--:--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
