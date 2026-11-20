// Tiny JSON-file store for challenges and runs (the money itself lives on Solana).
import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Challenge } from "./config";

const FILE =
  process.env.LOCKRUN_DATA_FILE ||
  (process.env.VERCEL ? "/tmp/challenges.json" : path.join(process.cwd(), "data", "challenges.json"));

function load(): Challenge[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}
function save(rows: Challenge[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(rows, null, 2));
}

export const newId = () => crypto.randomBytes(5).toString("hex");

export function listChallenges() {
  return load().sort((a, b) => b.createdAt - a.createdAt);
}

export function getChallenge(id: string) {
  return load().find((c) => c.id === id);
}

export function insertChallenge(c: Challenge) {
  const rows = load();
  rows.push(c);
  save(rows);
}

/** Read-modify-write one challenge. */
export function mutate(id: string, fn: (c: Challenge) => void): Challenge | undefined {
  const rows = load();
  const c = rows.find((x) => x.id === id);
  if (!c) return undefined;
  fn(c);
  save(rows);
  return c;
}
