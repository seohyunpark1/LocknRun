"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import AppShell from "@/components/AppShell";
import NameGate from "@/components/NameGate";
import AdSlot from "@/components/AdSlot";
import { explorerTx, money } from "@/lib/config";
import { Order, ShopItem, shopItem } from "@/lib/shop";
import { useMe } from "@/lib/client";

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...Array.from(bytes)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

type Filter = "all" | "sponsor" | "app";

/** Shop: spend what you won (Challengers-style) on sponsor rewards and Lock&Run items. */
export default function ShopPage() {
  const { me, ready, join } = useMe();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [pick, setPick] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bought, setBought] = useState<Order | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [s, w] = await Promise.all([
        fetch(`/api/shop?address=${me.address}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/wallet?address=${me.address}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setItems(s.items || []);
      setOrders((s.orders || []).sort((a: Order, b: Order) => (b.paidAt || 0) - (a.paidAt || 0)));
      setBalance(typeof w.usdc === "number" ? w.usdc : null);
    } catch {}
  }, [me]);

  useEffect(() => {
    load();
  }, [load]);

  async function buy(item: ShopItem) {
    if (!me) return;
    setErr("");
    setBusy(true);
    try {
      // 1) Server builds the payment (price from its own catalog) and signs only as fee payer.
      const r1 = await fetch("/api/shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", address: me.address, itemId: item.id }),
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error || "Couldn't start the purchase.");
      // 2) You approve it with your own key, on this device.
      const secret = localStorage.getItem("lockrun.secret");
      if (!secret) throw new Error("This device doesn't have your wallet key.");
      const tx = Transaction.from(fromB64(d1.tx));
      tx.partialSign(Keypair.fromSecretKey(bs58.decode(secret)));
      // 3) Submit and get your code.
      const r2 = await fetch("/api/shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", address: me.address, orderId: d1.orderId, tx: toB64(tx.serialize()) }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error || "Payment failed.");
      setPick(null);
      setBought(d2.order);
      window.dispatchEvent(new Event("lockrun:refresh"));
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;
  if (!me)
    return (
      <AppShell>
        <main className="wrap">
          <NameGate onJoin={(n) => join(n)} />
        </main>
      </AppShell>
    );

  const shown = items.filter((i) => filter === "all" || (filter === "app" ? i.brand === "Lock&Run" : i.brand !== "Lock&Run"));

  return (
    <AppShell>
      <main className="wrap">
        <section className="hero">
          <h1>
            Shop<br />
            <span className="hl">Spend what you won.</span>
          </h1>
          <p className="lede">Turn your winnings into gear and rewards from our sponsors. Pay with your balance in one tap.</p>
        </section>

        <div className="shop-bal">
          <div>
            <div className="small">Your balance</div>
            <div className="stat-num">{balance === null ? "—" : money(balance)}</div>
          </div>
          <Link href="/earnings" className="btn">My earnings</Link>
        </div>

        <div className="layout">
          <section>
            <div className="chips shop-filter" role="tablist">
              {(["all", "sponsor", "app"] as Filter[]).map((f) => (
                <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "sponsor" ? "Sponsors" : "Lock&Run"}
                </button>
              ))}
            </div>
            <div className="shop-grid">
              {shown.map((i) => {
                const owned = orders.filter((o) => o.itemId === i.id).length;
                const short = balance !== null && balance < i.price;
                return (
                  <button key={i.id} className="shop-item" onClick={() => { setErr(""); setPick(i); }}>
                    <span className="shop-icon" style={{ background: i.color }} aria-hidden>{i.icon}</span>
                    <span className="shop-brand">{i.brand}</span>
                    <b className="shop-name">{i.name}</b>
                    <span className="shop-foot">
                      <span className="shop-price">{money(i.price)}</span>
                      {owned > 0 ? <span className="shop-owned">Owned{owned > 1 ? ` ×${owned}` : ""}</span> : short ? <span className="muted small">Need {money(i.price - (balance || 0))} more</span> : <span className="shop-buy">Buy</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="card">
            <h2>My rewards</h2>
            {orders.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                Nothing yet. Finish a challenge at 100%, then come back and treat yourself.
              </p>
            ) : (
              <div className="reward-list">
                {orders.map((o) => {
                  const it = shopItem(o.itemId);
                  return (
                    <div key={o.id} className="reward">
                      <span className="shop-icon sm" style={{ background: it?.color }} aria-hidden>{it?.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="reward-name">{it?.name || o.itemId}</div>
                        <div className="muted small">{it?.brand} · {money(o.price)}</div>
                        <code className="reward-code">{o.code}</code>
                      </div>
                      {o.sig && (
                        <a className="small receipt" href={explorerTx(o.sig)} target="_blank" rel="noreferrer">receipt ↗</a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Sponsors: want your product here? Every purchase goes to runners who just finished a challenge.
            </p>
          </aside>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <AdSlot />
        </div>

        {pick && (
          <div className="modal" onClick={() => !busy && setPick(null)}>
            <div className="card shop-confirm" onClick={(e) => e.stopPropagation()}>
              <span className="shop-icon lg" style={{ background: pick.color }} aria-hidden>{pick.icon}</span>
              <div className="shop-brand">{pick.brand}</div>
              <h2 style={{ margin: "0.2rem 0 0.4rem" }}>{pick.name}</h2>
              <p className="muted small" style={{ marginTop: 0 }}>{pick.desc}</p>
              <div className="confirm-rows">
                <div><span>Price</span><b>{money(pick.price)}</b></div>
                <div><span>Your balance</span><b>{balance === null ? "—" : money(balance)}</b></div>
                <div><span>After</span><b>{balance === null ? "—" : money(Math.max(0, balance - pick.price))}</b></div>
              </div>
              {err && <p className="err">{err}</p>}
              <button className="btn primary block" disabled={busy || balance === null || balance < pick.price} onClick={() => buy(pick)}>
                {busy ? "Paying…" : balance !== null && balance < pick.price ? `Need ${money(pick.price - balance)} more` : `Pay ${money(pick.price)}`}
              </button>
              <button className="btn block" style={{ marginTop: "0.5rem" }} disabled={busy} onClick={() => setPick(null)}>
                Cancel
              </button>
              <p className="muted small" style={{ marginBottom: 0 }}>Paid in USDC on Solana. Network fees are on us.</p>
            </div>
          </div>
        )}

        {bought && (
          <div className="modal" onClick={() => setBought(null)}>
            <div className="card shop-confirm" onClick={(e) => e.stopPropagation()}>
              <span className="shop-icon lg" style={{ background: shopItem(bought.itemId)?.color }} aria-hidden>{shopItem(bought.itemId)?.icon}</span>
              <h2 style={{ margin: "0.5rem 0 0.25rem" }}>It&apos;s yours!</h2>
              <p className="muted small" style={{ marginTop: 0 }}>{shopItem(bought.itemId)?.name} · {shopItem(bought.itemId)?.brand}</p>
              <div className="muted small">Your code</div>
              <code className="reward-code big">{bought.code}</code>
              <button className="btn primary block" style={{ marginTop: "1rem" }} onClick={() => { navigator.clipboard?.writeText(bought.code || ""); setBought(null); }}>
                Copy code
              </button>
              {bought.sig && (
                <p className="small" style={{ marginBottom: 0 }}>
                  <a href={explorerTx(bought.sig)} target="_blank" rel="noreferrer">Payment receipt on Solana ↗</a>
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
