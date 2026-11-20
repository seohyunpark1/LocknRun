"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  options: number[];
  value: number;
  onChange: (v: number) => void;
  /** Big value shown next to the label, e.g. v => `${v} km` */
  format: (v: number) => string;
  /** Number printed under each tick, e.g. v => `$${v}` */
  tick?: (v: number) => string;
};

const CELL_REM = 3.25; // width of one stop on the ruler

/**
 * Kitchen-timer style picker: a ruler with tick marks scrolls under a fixed ▼ pointer
 * and snaps to the nearest value. Works with swipe (phone), trackpad, mouse drag and arrow keys.
 */
export default function Dial({ label, options, value, onChange, format, tick = String }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(Math.max(0, options.indexOf(value)));
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const drag = useRef<{ x: number; left: number } | null>(null);
  const lastIdx = useRef(live);

  const cellPx = () => {
    const el = track.current?.querySelector<HTMLElement>(".dial-cell");
    return el ? el.offsetWidth : 52;
  };

  const scrollToIndex = useCallback((i: number, smooth = true) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * cellPx(), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Put the current value under the pointer on first render (and if it changes from outside).
  useEffect(() => {
    const i = Math.max(0, options.indexOf(value));
    setLive(i);
    lastIdx.current = i;
    scrollToIndex(i, false);
  }, [value, options, scrollToIndex]);

  function onScroll() {
    const el = track.current;
    if (!el) return;
    const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollLeft / cellPx())));
    if (i !== lastIdx.current) {
      lastIdx.current = i;
      setLive(i);
      if ("vibrate" in navigator) navigator.vibrate?.(4); // tiny "click" on Android
    }
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (drag.current) return;
      if (options[i] !== value) onChange(options[i]);
      if (Math.abs(el.scrollLeft - i * cellPx()) > 1) scrollToIndex(i);
    }, 140);
  }

  // Mouse drag (touch and trackpads scroll natively).
  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || !track.current) return;
    drag.current = { x: e.clientX, left: track.current.scrollLeft };
    track.current.setPointerCapture(e.pointerId);
    track.current.classList.add("dragging");
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !track.current) return;
    track.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
  }
  function onPointerUp() {
    if (!drag.current || !track.current) return;
    drag.current = null;
    track.current.classList.remove("dragging");
    scrollToIndex(lastIdx.current);
    if (options[lastIdx.current] !== value) onChange(options[lastIdx.current]);
  }

  function onKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = Math.min(options.length - 1, Math.max(0, live + step));
    scrollToIndex(i);
    onChange(options[i]);
  }

  return (
    <div className="dial">
      <div className="dial-head">
        <span>{label}</span>
        <b>{format(options[live])}</b>
      </div>
      <div className="dial-body">
        <div className="dial-pointer" aria-hidden />
        <div
          ref={track}
          className="dial-track"
          style={{ ["--cell" as string]: `${CELL_REM}rem` }}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKey}
          tabIndex={0}
          role="slider"
          aria-label={label}
          aria-valuemin={options[0]}
          aria-valuemax={options[options.length - 1]}
          aria-valuenow={options[live]}
          aria-valuetext={format(options[live])}
        >
          {options.map((o, i) => (
            <button
              type="button"
              key={o}
              tabIndex={-1}
              className={`dial-cell ${i === live ? "on" : ""}`}
              onClick={() => {
                scrollToIndex(i);
                onChange(o);
              }}
            >
              <span className="tick minor" style={{ left: "10%" }} />
              <span className="tick minor" style={{ left: "30%" }} />
              <span className="tick major" />
              <span className="tick minor" style={{ left: "70%" }} />
              <span className="tick minor" style={{ left: "90%" }} />
              <span className="dial-num">{tick(o)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
