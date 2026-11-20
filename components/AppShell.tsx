"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { explorerAddress, money } from "@/lib/config";
import { useMe } from "@/lib/client";

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

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const d = await (await fetch("/api/challenges", { cache: "no-store" })).json();
        setEscrow(d.escrow);
      } catch {}
      if (!stop) setTimeout(load, 10000);
    }
    load();
    const onHash = () => setHash(window.location.hash);
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => {
      stop = true;
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const onHome = path === "/";
  const nav = [
    { href: "/", label: "Challenges", icon: <IconList />, on: onHome && hash !== "#new" && hash !== "#how" },
    { href: "/#new", label: "New challenge", short: "New", icon: <IconPlus />, on: onHome && hash === "#new" },
    { href: "/earnings", label: "My earnings", short: "Earnings", icon: <IconWallet />, on: path === "/earnings" },
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
        <div className="side-foot">
          {me && (
            <div className="side-me">
              <span className="avatar">{me.name.charAt(0).toUpperCase()}</span>
              <div style={{ minWidth: 0 }}>
                <div className="side-me-name">{me.name}</div>
                <div className="muted small">Runner</div>
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
          {me && <span className="me">{me.name}</span>}
        </header>

        {children}

        {/* ---------- Phone version: bottom tab bar ---------- */}
        <nav className="tabbar">
          {nav.map((n) => (
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
function IconWallet() {
  return (
    <svg {...svg} aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16 14.5h2" />
    </svg>
  );
}
