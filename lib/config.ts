// Shared settings and types, safe in the browser and on the server.

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
export const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

// Challenge options (server only accepts these).
export const DEPOSITS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50];
// Typed values are allowed anywhere in these ranges (the dials just offer common stops).
export const RANGES = {
  goalKm: { min: 0.5, max: 42.2, step: 0.1 },
  runs: { min: 1, max: 30, step: 1 },
  deposit: { min: 1, max: 100, step: 1 },
};
export const GOAL_KMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 21];
export const RUNS_REQUIRED = [1, 2, 3, 4, 5, 6, 7];
// "Ends in": pick a unit, then turn the dial for the number.
export const DURATION_UNITS = [
  { key: "min", label: "Min", word: "min", minutes: 1, values: [5, 10, 15, 20, 30, 45], min: 5, max: 59 },
  { key: "hour", label: "Hour", word: "hour", minutes: 60, values: [1, 2, 3, 4, 5, 6, 8, 10, 12, 18], min: 1, max: 23 },
  { key: "day", label: "Day", word: "day", minutes: 1440, values: [1, 2, 3, 4, 5, 6], min: 1, max: 30 },
  { key: "week", label: "Week", word: "week", minutes: 10080, values: [1, 2, 3, 4], min: 1, max: 12 },
  { key: "month", label: "Month", word: "month", minutes: 43200, values: [1, 2, 3, 4, 5, 6], min: 1, max: 6 }, // 1 month = 30 days
];

/** Shortest and longest challenge the server accepts, in minutes. */
export const DURATION_LIMITS = { min: 5, max: 6 * 43200 };

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

/** approved: counts toward the goal. pending: needs review and holds that day's check-in slot. rejected: does not count. */
export type CheckInStatus = "approved" | "pending" | "rejected";

export type Run = {
  id: string;
  km: number;
  sec: number;
  at: number; // when the check-in was submitted
  startedAt?: number; // when the server-issued run session began; decides the room day
  roomDay?: string; // YYYY-MM-DD in the challenge's time zone
  counts: boolean; // true only when approved
  status?: CheckInStatus; // missing on older runs: counts decides
  reason?: string; // why a check-in is pending or rejected
  source?: "gps" | "strava"; // phone-recorded movement, or a run imported from Strava
  photo?: boolean; // the photo check-in is stored for this run (GET /api/photos/<run id>)
  stravaId?: number; // Strava activity id, for imported runs
  stravaName?: string;
  proofSig?: string; // Solana memo transaction that stamps the proof on-chain
};

/** Pace between these bounds is accepted automatically; the fastest sliver goes to review. */
export const REVIEW_PACE_SEC_PER_KM = 210; // faster than 3:30/km needs a second look
/** After a challenge ends, unresolved pending check-ins can hold the payout for this long. */
export const REVIEW_WINDOW_MS = 24 * 3600_000;
/** Participants may not run farther than this multiple of the goal in one check-in without review. */
export const MAX_SESSION_SEC = 6 * 3600;

/** The room day (YYYY-MM-DD) of a moment, in the challenge's fixed time zone. */
export function roomDay(at: number, timeZone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}
export const validTimeZone = (tz: unknown): tz is string => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: String(tz) }); return typeof tz === "string" && tz.length < 64; } catch { return false; }
};
/** Number of distinct room days a challenge window touches. */
export function roomDaysIn(c: Pick<Challenge, "createdAt" | "endsAt" | "timeZone">) {
  const days = new Set<string>();
  for (let t = c.createdAt; t < c.endsAt + 3_600_000; t += 3_600_000) days.add(roomDay(Math.min(t, c.endsAt), c.timeZone));
  return days.size;
}

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

/** pool = all-or-nothing: finishers split the pool. fraction = Challengers-style tiers by share of runs completed. */
export type RewardMode = "pool" | "fraction";
export type Visibility = "public" | "private";
export const rewardModeOf = (c: Pick<Challenge, "rewardMode">): RewardMode => c.rewardMode ?? "pool";
export const isPrivate = (c: Pick<Challenge, "visibility">) => c.visibility === "private";

export type ChallengeStatus = "draft" | "active" | "settling" | "settled";

/** A brand that added bonus money to a challenge's pot (split among finishers). */
export type Sponsor = { address?: string; refundSig?: string; name: string; amount: number; url?: string; at: number; sig: string; logo?: boolean; tagline?: string };
export const MAX_LOGO_BYTES = 150_000; // sponsor logos are shrunk to 256px in the browser first
export const sponsorLogoUrl = (challengeId: string, index: number) => `/api/sponsor-logo/${challengeId}/${index}`;

export type Partner = { name: string; domain: string; logo: string; url: string; role: string };

/**
 * Partners shown in the "Partners" card at the top of the home page, the "Powered by" strip and the sidebar.
 * Logos: an official file in /public/partners/<file> is used if you add one; otherwise the company's own
 * site icon is loaded from its domain; if neither loads, the name is shown.
 */
export const PARTNERS: Partner[] = [
  { name: "Solana", domain: "solana.com", logo: "/partners/solana.png", url: "https://solana.com", role: "Escrow, payouts and run proofs" },
  { name: "USDC", domain: "circle.com", logo: "/partners/usdc.svg", url: "https://www.circle.com", role: "Circle's digital dollar, used for every deposit and payout" },
  { name: "QuickNode", domain: "quicknode.com", logo: "/partners/quicknode.png", url: "https://www.quicknode.com", role: "Fast connection to Solana" },
  { name: "Strava", domain: "strava.com", logo: "/partners/strava.png", url: "https://www.strava.com", role: "Import runs as proof" },
];

/** Where to look for a partner's logo, in order. */
export const partnerLogoSources = (p: Partner) => [p.logo, `https://www.google.com/s2/favicons?domain=${p.domain}&sz=128`];
// Logo files live in /public/partners (Solana, QuickNode and Strava provided by the team; USDC from the CC0 cryptocurrency-icons set).
export const partnerByName = (name: string) => PARTNERS.find((p) => p.name === name)!;
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
  timeZone?: string; // IANA zone that defines room days; displayed before joining
  rewardMode?: RewardMode; // how the pool is shared; missing = "pool"
  visibility?: Visibility; // missing = public
  inviteCode?: string; // private challenges: the secret in the invite link; only participants ever see it
  status: ChallengeStatus;
  participants: Participant[];
  pendingDeposits?: string[];
  sponsors?: Sponsor[];
  sponsorRefundSig?: string; // bonus returned to sponsors when nobody finished
  settledAt?: number;
};

export const bonusOf = (c: Challenge) => (c.sponsors || []).reduce((s, x) => s + x.amount, 0);
export const potOf = (c: Challenge) => c.deposit * c.participants.length + bonusOf(c);

export function countedRuns(p: Participant) {
  return p.runs.filter((r) => r.counts).length;
}
export const runStatus = (r: Run): CheckInStatus => r.status ?? (r.counts ? "approved" : "rejected");

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
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`;
}

export function pace(secPerKm: number) {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "--:--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
