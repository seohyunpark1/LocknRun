// Shared settings and types, safe in the browser and on the server.

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
export const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

// Challenge options (server only accepts these).
export const DEPOSITS = [5, 10, 20];
export const GOAL_KMS = [1, 3, 5, 10];
export const RUNS_REQUIRED = [1, 2, 3, 5];
export const DURATIONS: { label: string; minutes: number }[] = [
  { label: "15 min", minutes: 15 },
  { label: "1 day", minutes: 60 * 24 },
  { label: "1 week", minutes: 60 * 24 * 7 },
];

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
  settledAt?: number;
};

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
