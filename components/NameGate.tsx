"use client";
import { useState } from "react";

export default function NameGate({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState("");
  const go = () => name.trim() && onJoin(name);
  return (
    <div className="modal">
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>Welcome to Lock&Run</h2>
        <p className="muted" style={{ marginTop: 0 }}>What&apos;s your runner name?</p>
        <input
          className="input"
          autoFocus
          maxLength={24}
          placeholder="First name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button className="btn primary block" style={{ marginTop: 14 }} onClick={go}>
          Continue
        </button>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Your payment account is set up automatically. No app, no crypto knowledge needed.
        </p>
      </div>
    </div>
  );
}
