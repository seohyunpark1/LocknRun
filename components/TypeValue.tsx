"use client";
import { useEffect, useState } from "react";

type Props = {
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  /** 1 = whole numbers, 0.1 = one decimal */
  step?: number;
  prefix?: string;
  suffix?: string;
  label: string;
};

/** A big number you can tap and type into, e.g. "[3] km" or "$[10]". Clamped to min/max on Enter or blur. */
export default function TypeValue({ value, onCommit, min, max, step = 1, prefix = "", suffix = "", label }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  function commit() {
    const n = Number(draft.replace(",", "."));
    if (!isFinite(n) || draft.trim() === "") {
      setDraft(String(value));
      return;
    }
    const rounded = Math.round(n / step) * step;
    const clean = Math.min(max, Math.max(min, Number(rounded.toFixed(step < 1 ? 1 : 0))));
    setDraft(String(clean));
    if (clean !== value) onCommit(clean);
  }

  return (
    <label className={`type-value ${prefix ? "has-prefix" : ""}`} title={`Tap to type (${min}–${max})`}>
      {prefix}
      <input
        aria-label={label}
        inputMode={step < 1 ? "decimal" : "numeric"}
        value={draft}
        style={{ width: `${Math.max(1, draft.length) + 0.6}ch` }}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {suffix && <span className="type-suffix">{suffix}</span>}
      <span className="type-pencil" aria-hidden>✎</span>
    </label>
  );
}
