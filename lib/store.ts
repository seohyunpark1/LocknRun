// Storage for challenges and runs (the money itself lives on Solana).
// - On Vercel: Upstash Redis (add it from the Vercel dashboard: Storage / Marketplace -> Upstash for Redis).
// - Locally: a JSON file in data/challenges.json, no setup needed.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import type { Challenge } from "./config";

export const newId = () => crypto.randomBytes(5).toString("hex");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;
const HASH = "lockrun:challenges";

if (!redis && process.env.VERCEL) {
  console.warn("Lock&Run: no Redis configured. Challenges will NOT persist on Vercel. Add Upstash for Redis.");
}

// ---------- file fallback (local dev) ----------
const FILE =
  process.env.LOCKRUN_DATA_FILE ||
  (process.env.VERCEL ? "/tmp/challenges.json" : path.join(process.cwd(), "data", "challenges.json"));

function fileLoad(): Challenge[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}
function fileSave(rows: Challenge[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, FILE);
}

// ---------- public API ----------
export async function listChallenges(): Promise<Challenge[]> {
  let rows: Challenge[];
  if (redis) {
    const all = (await redis.hgetall<Record<string, Challenge>>(HASH)) || {};
    rows = Object.values(all);
  } else {
    rows = fileLoad();
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getChallenge(id: string): Promise<Challenge | undefined> {
  if (redis) return (await redis.hget<Challenge>(HASH, id)) || undefined;
  return fileLoad().find((c) => c.id === id);
}

export async function insertChallenge(c: Challenge) {
  if (redis) {
    await redis.hset(HASH, { [c.id]: c });
    return;
  }
  const rows = fileLoad();
  rows.push(c);
  fileSave(rows);
}

/** Read-modify-write one challenge. */
export async function mutate(id: string, fn: (c: Challenge) => void): Promise<Challenge | undefined> {
  if (redis) {
    const c = await getChallenge(id);
    if (!c) return undefined;
    fn(c);
    await redis.hset(HASH, { [id]: c });
    return c;
  }
  const rows = fileLoad();
  const c = rows.find((x) => x.id === id);
  if (!c) return undefined;
  fn(c);
  fileSave(rows);
  return c;
}

// ---------- locks (so two requests can't pay out or join at the same moment) ----------
const memLocks = new Map<string, { token: string; expires: number }>();
export async function acquireLock(key: string, ttlSec = 120): Promise<string | null> {
  const token = crypto.randomUUID();
  if (redis) return (await redis.set(`lockrun:lock:${key}`, token, { nx: true, ex: ttlSec })) === "OK" ? token : null;
  if ((memLocks.get(key)?.expires ?? 0) > Date.now()) return null;
  memLocks.set(key, { token, expires: Date.now() + ttlSec * 1000 });
  return token;
}
export async function releaseLock(key: string, token: string) {
  if (redis) {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [`lockrun:lock:${key}`], [token]);
  } else if (memLocks.get(key)?.token === token) memLocks.delete(key);
}

// ---------- simple key/value (photos, Strava tokens) ----------
const KV_DIR = process.env.VERCEL ? "/tmp/lockrun-kv" : path.join(path.dirname(FILE), "kv");
const kvFile = (key: string) => path.join(KV_DIR, key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");

export async function kvGet<T>(key: string): Promise<T | null> {
  if (redis) return (await redis.get<T>(`lockrun:${key}`)) ?? null;
  try {
    return JSON.parse(fs.readFileSync(kvFile(key), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown) {
  if (redis) {
    await redis.set(`lockrun:${key}`, value);
    return;
  }
  fs.mkdirSync(KV_DIR, { recursive: true });
  fs.writeFileSync(kvFile(key), JSON.stringify(value));
}

/** Run photos are stored apart from challenges so the challenge list stays small. */
export const savePhoto = (runId: string, dataUrl: string) => kvSet(`photo:${runId}`, dataUrl);
export const getPhoto = (runId: string) => kvGet<string>(`photo:${runId}`);
