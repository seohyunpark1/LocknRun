import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import crypto from "node:crypto";
import { prepareStorePayment, submitStorePayment, usdcBalance } from "@/lib/solana-server";
import { kvGet, kvSet, acquireLock, releaseLock } from "@/lib/store";
import { Order, SHOP_ITEMS, shopItem } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ordersKey = (address: string) => `orders:${address}`;
const isAddress = (a: unknown) => {
  try {
    new PublicKey(String(a));
    return true;
  } catch {
    return false;
  }
};
const publicOrder = ({ message, ...o }: Order) => o; // eslint-disable-line @typescript-eslint/no-unused-vars

// GET /api/shop?address=<wallet>  ->  catalog + this runner's paid orders (with codes)
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  const orders = isAddress(address) ? ((await kvGet<Order[]>(ordersKey(address))) || []).filter((o) => o.status === "paid") : [];
  return NextResponse.json({ items: SHOP_ITEMS, orders: orders.map(publicOrder) });
}

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30; // generous: a whole room on one Wi-Fi shares an IP
}

// POST /api/shop  { action: "prepare", address, itemId }  ->  { orderId, tx }
//                 { action: "submit", address, orderId, tx } ->  { order }  (with coupon code)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  if (limited(ip)) return NextResponse.json({ error: "Slow down a little!" }, { status: 429 });
  if (!isAddress(body.address)) return NextResponse.json({ error: "Missing your wallet. Refresh the page." }, { status: 400 });
  const address = String(body.address);

  try {
    if (body.action === "prepare") {
      const item = shopItem(String(body.itemId));
      if (!item) return NextResponse.json({ error: "That item isn't in the shop." }, { status: 404 });
      const balance = await usdcBalance(address);
      if (balance < item.price) return NextResponse.json({ error: `You need ${item.price} USDC. Your balance is ${balance}.` }, { status: 400 });
      const orderId = crypto.randomBytes(5).toString("hex");
      const { tx, message } = await prepareStorePayment(address, item.price, orderId); // price comes from the server's catalog
      const orders = (await kvGet<Order[]>(ordersKey(address))) || [];
      orders.push({ id: orderId, itemId: item.id, address, price: item.price, status: "pending", createdAt: Date.now(), message });
      await kvSet(ordersKey(address), orders.slice(-100));
      return NextResponse.json({ orderId, tx });
    }

    if (body.action === "submit") {
      if (typeof body.tx !== "string" || body.tx.length > 4000) return NextResponse.json({ error: "Invalid payment" }, { status: 400 });
      const lock = `order:${body.orderId}`;
      if (!(await acquireLock(lock, 60))) return NextResponse.json({ error: "Already processing this order." }, { status: 409 });
      try {
        const orders = (await kvGet<Order[]>(ordersKey(address))) || [];
        const o = orders.find((x) => x.id === body.orderId);
        if (!o) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        if (o.status === "paid") return NextResponse.json({ order: publicOrder(o) });
        const sig = await submitStorePayment(body.tx, o.message!);
        const item = shopItem(o.itemId)!;
        const code = `${item.codePrefix}-${crypto.randomBytes(2).toString("hex").toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
        Object.assign(o, { status: "paid", sig, code, paidAt: Date.now() });
        await kvSet(ordersKey(address), orders);
        return NextResponse.json({ order: publicOrder(o) });
      } finally {
        await releaseLock(lock);
      }
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Purchase failed";
    console.error("shop:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
