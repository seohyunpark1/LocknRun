import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prepareWithdraw, submitWithdraw, usdcBalance } from "@/lib/solana-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const isAddress = (a: unknown) => {
  try {
    new PublicKey(String(a));
    return true;
  } catch {
    return false;
  }
};

// GET /api/wallet?address=<wallet>  ->  { usdc }
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!isAddress(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  return NextResponse.json({ usdc: await usdcBalance(address!) });
}

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 6;
}

// POST /api/wallet  { action: "prepare", from, to, amount }  or  { action: "submit", tx }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  if (limited(ip)) return NextResponse.json({ error: "Slow down a little!" }, { status: 429 });
  try {
    if (body.action === "prepare") {
      if (!isAddress(body.from) || !isAddress(body.to)) return NextResponse.json({ error: "That isn't a valid Solana address." }, { status: 400 });
      if (body.from === body.to) return NextResponse.json({ error: "Send to a different wallet." }, { status: 400 });
      const amount = Math.floor(Number(body.amount) * 100) / 100;
      const balance = await usdcBalance(body.from);
      if (!(amount > 0) || amount > balance) return NextResponse.json({ error: `You can cash out up to $${balance}.` }, { status: 400 });
      return NextResponse.json({ tx: await prepareWithdraw(body.from, body.to, amount) });
    }
    if (body.action === "submit") {
      if (typeof body.tx !== "string" || body.tx.length > 4000) return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
      return NextResponse.json({ signature: await submitWithdraw(body.tx) });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cash out failed";
    console.error("wallet:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
