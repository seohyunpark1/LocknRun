"use client";
import { useMemo } from "react";
import Link from "next/link";
import { explorerTx, money, partnerByName, partnerLogoSources } from "@/lib/config";
import type { Challenge } from "@/lib/config";
import { prizeBreakdown } from "@/lib/settle";
import { PartnerLogo, SponsorMark } from "./Logos";

/** finished = you completed the goal (stake back + share of the pool), refund = nobody finished so every stake was returned */
export type Win = { c: Challenge; payout: number; paySig?: string; kind: "finished" | "refund" };


const COLORS = ["#22c55e", "#16a34a", "#86efac", "#fde047", "#34d399", "#bbf7d0"];

/** Full-screen "Congratulations, you earned $X" pop-up, shown on any page when a payout lands. */
export default function Celebration({ win, name, onClose }: { win: Win; name: string; onClose: () => void }) {
  const { c, payout, paySig, kind } = win;
  const refund = kind === "refund";
  const won = kind === "finished";
  const pb = prizeBreakdown(c);
  const heading = won
    ? `Congratulations, ${name}!`
    : `Your stake is back, ${name}`;
  const sub = won
    ? `You finished “${c.title}”. Your stake is back${payout > c.deposit ? ", plus your share of the pool." : "."}`
    : "Nobody finished this challenge, so every stake was refunded.";
  // The sponsor who put in the most is front and center: they're paying for this moment.
  const ranked = (c.sponsors || []).map((s, index) => ({ s, index })).sort((x, y) => y.s.amount - x.s.amount);
  const top = ranked[0];
  const others = ranked.length - 1;
  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 2.2 + Math.random() * 1.6,
        rot: Math.random() * 360,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 6,
      })),
    []
  );

  return (
    <div className="celebrate" role="dialog" aria-modal="true" aria-label="Congratulations">
      {won && (
        <div className="confetti" aria-hidden>
          {confetti.map((p, i) => (
            <span
              key={i}
              style={{
                left: `${p.left}%`,
                width: p.w,
                height: p.w * 1.6,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
                transform: `rotate(${p.rot}deg)`,
              }}
            />
          ))}
        </div>
      )}
      <div className="celebrate-card">
        {top ? (
          <>
            <div className="celebrate-sponsor-logo">
              <SponsorMark c={c} index={top.index} s={top.s} size="lg" />
            </div>
            <div className="muted small">
              {refund ? "Stake returned" : "Presented by"} <b className="celebrate-presenter">{top.s.name}</b>
              {others > 0 && <> + {others} more</>}
            </div>
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="celebrate-applogo" src="/icon-192.png" alt="Lock&Run" />
            <div className="muted small">{refund ? "Stake returned" : "Challenge complete"}</div>
          </>
        )}
        <div className={`tier-pill tier-${kind}`}>{refund ? "Refund" : "Finished"}</div>
        <h2 className="celebrate-title">{heading}</h2>
        <div className={`celebrate-amt ${won ? "" : "muted-amt"}`}>+{money(payout)}</div>
        <div className="muted">{sub}</div>

        {won && (
          <div className="celebrate-break">
            <div><span>Your stake back</span><b>{money(c.deposit)}</b></div>
            {pb.fromOthers > 0 && <div><span>Share of forfeited stakes</span><b>+{money(pb.fromOthers)}</b></div>}
            {pb.bonusShare > 0 && (
              <div>
                <span className="celebrate-sponsor">
                  {(c.sponsors || []).map((s, i) => (
                    <SponsorMark key={i} c={c} index={i} s={s} size="sm" />
                  ))}
                  Sponsor bonus
                </span>
                <b>+{money(pb.bonusShare)}</b>
              </div>
            )}
            <div className="total"><span>Total paid to you</span><b>{money(payout)}</b></div>
          </div>
        )}

        <div className="celebrate-actions">
          <Link href="/earnings" className="btn primary block" onClick={onClose}>
            See my earnings
          </Link>
          <Link href="/shop" className="btn block" onClick={onClose}>
            Spend it in the Shop
          </Link>
          <button className="btn block" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="celebrate-chain">
          <span className="muted small">Paid out on</span>
          <PartnerLogo src={partnerLogoSources(partnerByName("Solana"))} name="Solana" className="celebrate-chain-logo" />
          <b className="small">Solana</b>
          {paySig && (
            <a className="small muted" href={explorerTx(paySig)} target="_blank" rel="noreferrer">
              · receipt ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
