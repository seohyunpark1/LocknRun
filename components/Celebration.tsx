"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Challenge, explorerTx, isFinisher, money } from "@/lib/config";
import { PartnerLogo, SponsorMark } from "./Logos";

export type Win = { c: Challenge; payout: number; paySig?: string; refund: boolean };

/** Splits a finisher's payout into: deposit back + quitters' money + sponsor bonus. */
function breakdown(c: Challenge, payout: number) {
  const finishers = c.participants.filter((p) => isFinisher(c, p)).length || 1;
  const quitters = c.participants.length - finishers;
  const fromQuitters = Math.floor((quitters * c.deposit * 100) / finishers) / 100;
  const bonus = Math.max(0, Math.round((payout - c.deposit - fromQuitters) * 100) / 100);
  return { deposit: c.deposit, fromQuitters, bonus };
}

const COLORS = ["#22c55e", "#16a34a", "#86efac", "#fde047", "#34d399", "#bbf7d0"];

/** Full-screen "Congratulations, you earned $X" pop-up, shown on any page when a payout lands. */
export default function Celebration({ win, name, onClose }: { win: Win; name: string; onClose: () => void }) {
  const { c, payout, paySig, refund } = win;
  const b = breakdown(c, payout);
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
      {!refund && (
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
        <div className="celebrate-medal" aria-hidden>{refund ? "↩" : "🏅"}</div>
        <div className="muted small">{refund ? "Deposit returned" : "Challenge complete"}</div>
        <h2 className="celebrate-title">{refund ? `Your money is back, ${name}` : `Congratulations, ${name}!`}</h2>
        <div className="celebrate-amt">+{money(payout)}</div>
        <div className="muted">{refund ? "Nobody finished, so every deposit was refunded." : `You finished “${c.title}” and got paid.`}</div>

        {!refund && (
          <div className="celebrate-break">
            <div><span>Your deposit back</span><b>{money(b.deposit)}</b></div>
            {b.fromQuitters > 0 && <div><span>From the quitters</span><b>+{money(b.fromQuitters)}</b></div>}
            {b.bonus > 0 && (
              <div>
                <span className="celebrate-sponsor">
                  {(c.sponsors || []).map((s, i) => (
                    <SponsorMark key={i} c={c} index={i} s={s} size="sm" />
                  ))}
                  Sponsor bonus
                </span>
                <b>+{money(b.bonus)}</b>
              </div>
            )}
            <div className="total"><span>Total paid to you</span><b>{money(payout)}</b></div>
          </div>
        )}

        <div className="celebrate-actions">
          <Link href="/earnings" className="btn primary block" onClick={onClose}>
            See my earnings
          </Link>
          <button className="btn block" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="celebrate-chain">
          <span className="muted small">Paid out on</span>
          <PartnerLogo src="/partners/solana.svg" name="Solana" className="celebrate-chain-logo" />
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
