// Strava integration (server only): OAuth connect + reading the runner's own activities.
// Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (from https://www.strava.com/settings/api) to turn it on.
import "server-only";
import crypto from "node:crypto";
import { kvGet, kvSet } from "./store";

const CLIENT_ID = process.env.STRAVA_CLIENT_ID || "";
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || "";
export const stravaEnabled = () => !!(CLIENT_ID && CLIENT_SECRET);

type Tokens = { access_token: string; refresh_token: string; expires_at: number; athlete: string };
const tokenKey = (address: string) => `strava:${address}`;

// The OAuth "state" carries the runner's wallet address and where to return, signed so it can't be forged.
export function signState(data: { address: string; back: string }) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto.createHmac("sha256", CLIENT_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function readState(state: string): { address: string; back: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", CLIENT_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

export function authorizeUrl(origin: string, state: string) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${origin}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  if (!r.ok) throw new Error(`Strava sign-in failed (${r.status}). ${r.status === 403 ? "The app's athlete limit may be reached." : ""}`);
  return r.json();
}

export async function connect(address: string, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code" });
  const athlete = [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(" ") || "Strava athlete";
  await kvSet(tokenKey(address), { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, athlete });
  return athlete;
}

export async function connectedAthlete(address: string) {
  return (await kvGet<Tokens>(tokenKey(address)))?.athlete || null;
}

async function accessToken(address: string) {
  const t = await kvGet<Tokens>(tokenKey(address));
  if (!t) throw new Error("Connect Strava first.");
  if (t.expires_at - 60 > Date.now() / 1000) return t.access_token;
  const n = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await kvSet(tokenKey(address), { ...t, access_token: n.access_token, refresh_token: n.refresh_token, expires_at: n.expires_at });
  return n.access_token as string;
}

export type StravaRun = { id: number; name: string; km: number; sec: number; startedAt: number };

const RUN_TYPES = ["Run", "TrailRun", "VirtualRun"];
function toRun(a: Record<string, unknown>): StravaRun {
  return {
    id: Number(a.id),
    name: String(a.name || "Run"),
    km: Math.round((Number(a.distance) / 1000) * 100) / 100,
    sec: Number(a.moving_time),
    startedAt: Date.parse(String(a.start_date)),
  };
}
const isRun = (a: Record<string, unknown>) => RUN_TYPES.includes(String(a.sport_type || a.type));

async function api(address: string, path: string) {
  const r = await fetch(`https://www.strava.com/api/v3${path}`, { headers: { Authorization: `Bearer ${await accessToken(address)}` } });
  if (!r.ok) throw new Error(`Strava error ${r.status}`);
  return r.json();
}

/** The runner's runs that started after `afterMs`. */
export async function listRuns(address: string, afterMs: number): Promise<StravaRun[]> {
  const list = (await api(address, `/athlete/activities?after=${Math.floor(afterMs / 1000)}&per_page=30`)) as Record<string, unknown>[];
  return list.filter(isRun).map(toRun).sort((a, b) => b.startedAt - a.startedAt);
}

/** One activity, fetched by the server itself so the client can't fake distance or time. */
export async function getRun(address: string, id: number): Promise<StravaRun | null> {
  const a = (await api(address, `/activities/${id}`)) as Record<string, unknown>;
  return isRun(a) ? toRun(a) : null;
}
