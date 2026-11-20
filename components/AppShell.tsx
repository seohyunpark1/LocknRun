"use client";
import WalletStatus from "./WalletStatus";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Challenge, explorerAddress, money, partnerByName, partnerLogoSources } from "@/lib/config";
import { computePayouts } from "@/lib/settle";
import { weeklyRanking } from "@/lib/streaks";
import { speak, useMe } from "@/lib/client";
import Celebration, { Win } from "./Celebration";
import { PartnerLogo } from "./Logos";

const CELEBRATED = "lockrun.celebrated"; // challenge ids we've already congratulated this runner for

function readCelebrated(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CELEBRATED) || "[]");
  } catch {
    return [];
  }
}

type Escrow = { address: string | null; balance: number | null };

/**
 * Two versions of the same app, chosen by screen size:
 *  - Web (laptops/desktops, ≥1024px): dashboard with a left sidebar.
 *  - Phone (<1024px): app-style top bar + bottom tab bar.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { me } = useMe();
  const path = usePathname();
  const [escrow, setEscrow] = useState<Escrow>({ address: null, balance: null });
  const [hash, setHash] = useState("");
  const [win, setWin] = useState<Win | null>(null);
  const [streak, setStreak] = useState(0); // days in a row with a counted run
  const [gold, setGold] = useState(false); // owns the "Gold runner badge" from the Shop

  useEffect(() => {
    if (!me) return;
    const check = () =>
      fetch(`/api/shop?address=${me.address}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setGold((d.orders || []).some((o: { itemId: string }) => o.itemId === "gold-name")))
        .catch(() => {});
    check();
    window.addEventListener("lockrun:refresh", check);
    return () => window.removeEventListener("lockrun:refresh", check);
  }, [me]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      clearTimeout(timer);
      try {
        const d = await (await fetch("/api/challenges", { cache: "no-store" })).json();
        setEscrow(d.escrow);
        checkForPayout(d.challenges || []);
        const meRaw = localStorage.getItem("lockrun.me");
        if (meRaw) {
          const addr = JSON.parse(meRaw).address;
          setStreak(weeklyRanking(d.challenges || [], Date.now()).find((r) => r.address === addr)?.streak || 0);
        }
      } catch {}
      if (!stop) timer = setTimeout(load, 8000);
    }
    // When this runner gets paid (on any page), show the Congratulations pop-up once per challenge.
    function checkForPayout(list: Challenge[]) {
      if (!me) return;
      const address = me.address;
      const seen = readCelebrated();
      for (const c of list) {
        if (c.status !== "settled" || seen.includes(`${address}:${c.id}`)) continue;
        if (c.settledAt && Date.now() - c.settledAt > 7 * 86400_000) continue; // only recent payouts
        const p = c.participants.find((x) => x.address === address);
        if (!p) continue;
        localStorage.setItem(CELEBRATED, JSON.stringify([...seen, `${address}:${c.id}`]));
        if ((p.payout || 0) <= 0) return; // nothing back: no pop-up
        const { payouts } = computePayouts(c);
        const mine = payouts.find((x) => x.address === address)!;
        const nobodyWon = !payouts.some((x) => x.tier === "full");
        const kind = nobodyWon ? "refund" : mine.tier;
        setWin({ c, payout: p.payout || 0, paySig: p.paySig, kind, rate: mine.rate });
        speak(
          kind === "full"
            ? `Congratulations! You hit 100 percent and won ${p.payout} dollars.`
            : kind === "safe"
              ? `So close! Your ${c.deposit} dollars are back.`
              : kind === "refund"
                ? `Your ${c.deposit} dollars are back in your account.`
                : `You got ${p.payout} dollars back.`
        );
        return;
      }
    }
    load();
    const refresh = () => load();
    window.addEventListener("lockrun:refresh", refresh);
    const onHash = () => setHash(window.location.hash);
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("lockrun:refresh", refresh);
    };
  }, [me?.address]);

  const onHome = path === "/";
  const nav = [
    { href: "/", label: "Challenges", icon: <IconList />, on: onHome && hash !== "#new" && hash !== "#how" },
    { href: "/#new", label: "New challenge", short: "New", icon: <IconPlus />, on: onHome && hash === "#new" },
    { href: "/earnings", label: "My earnings", short: "Earnings", icon: <IconWallet />, on: path === "/earnings" },
    { href: "/ranking", label: "Ranking", icon: <IconTrophy />, on: path === "/ranking" },
    { href: "/#how", label: "How it works", short: "How", icon: <IconInfo />, on: onHome && hash === "#how" },
  ];

  return (
    <div className="shell">
      {/* ---------- Web version: sidebar ---------- */}
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-dot" /> Lock&Run
        </Link>
        <nav className="side-nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`side-link ${n.on ? "on" : ""}`} onClick={() => setHash(n.href.split("#")[1] ? "#" + n.href.split("#")[1] : "")}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="side-card">
          <div className="muted small">On the line right now</div>
          <div className="side-amt">{escrow.balance === null ? "—" : money(escrow.balance)}</div>
          <div className="muted small">held in escrow on Solana</div>
          {escrow.address && (
            <a className="small" href={explorerAddress(escrow.address)} target="_blank" rel="noreferrer">
              Verify on Solana ↗
            </a>
          )}
        </div>
        <div className="side-built">
          <PartnerLogo src={partnerLogoSources(partnerByName("Solana"))} name="Solana" className="side-built-logo" />
          <div className="small">Built on <b>Solana</b></div>
          <div className="muted small">Every deposit, payout and run proof is recorded on-chain.</div>
        </div>
        <div className="side-foot">
          <WalletStatus />
          {me && (
            <div className="side-me">
              <span className="avatar">{me.name.charAt(0).toUpperCase()}</span>
              <div style={{ minWidth: 0 }}>
                <div className="side-me-name">{me.name}{gold && <span className="gold-star" title="Gold runner">★</span>}</div>
                <div className="muted small">{gold ? "Gold runner" : "Runner"}{streak > 0 && <> · <Link href="/ranking" className="side-streak">🔥 {streak}-day streak</Link></>}</div>
              </div>
            </div>
          )}
          <div className="small" style={{ color: "var(--faint)", marginTop: "0.75rem" }}>Solana devnet · test money only</div>
        </div>
      </aside>

      <div className="main">
        {/* ---------- Phone version: top bar ---------- */}
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-dot" /> Lock&Run
          </Link>
          <WalletStatus />
          {me && (
            <span className="me">
              {streak > 0 && <span className="me-streak">🔥{streak}</span>}
              {me.name}
              {gold && <span className="gold-star">★</span>}
            </span>
          )}
        </header>

        {children}

        {win && me && <Celebration win={win} name={me.name} onClose={() => setWin(null)} />}

        {/* ---------- Phone version: bottom tab bar ---------- */}
        <nav className="tabbar">
          {[nav[0], nav[2], nav[1], nav[3], nav[4]].map((n) => ( /* phone: New in the middle; "How it works" stays on the home page */
            <Link key={n.href} href={n.href} className={`tab ${n.on ? "on" : ""} ${n.short === "New" ? "tab-new" : ""}`} onClick={() => setHash(n.href.split("#")[1] ? "#" + n.href.split("#")[1] : "")}>
              {n.icon}
              <span>{n.short || n.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

const svg = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconList() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconInfo() {
  return (
    <svg {...svg} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
    </svg>
  );
}
function IconBag() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8z" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" />
    </svg>
  );
}
function IconWallet() {
  return (
    <svg {...svg} aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16 14.5h2" />
    </svg>
  );
}
