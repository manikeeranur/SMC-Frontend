"use client";

import { useState } from "react";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;
const API   = process.env.NEXT_PUBLIC_API_URL || "http://13.61.175.6:4000";

interface Props {
  onConnected: (userName: string) => void;
  errorMsg?:   string;
}

export function KiteAuth({ onConnected, errorMsg }: Props) {
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res  = await fetch(`${API}/api/auth/login`);
      const data = await res.json();
      if (data.error) { alert(data.error); setConnecting(false); return; }
      window.location.href = data.loginUrl;
    } catch {
      alert(`Cannot reach backend at ${API}`);
      setConnecting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen relative overflow-hidden"
      style={{ background: "#050a0f" }}>

      {/* Grid background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(2,132,199,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(2,132,199,0.04) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
      }} />

      {/* Top ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] pointer-events-none" style={{
        background: "radial-gradient(ellipse at 50% 0%, rgba(2,132,199,0.10) 0%, transparent 65%)",
      }} />
      {/* Bottom orange glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] pointer-events-none" style={{
        background: "radial-gradient(ellipse at 50% 100%, rgba(234,88,12,0.07) 0%, transparent 70%)",
      }} />

      {/* Main layout */}
      <div className="relative z-10 w-[420px] flex flex-col items-center">

        {/* Status pill */}
        <div className="flex items-center gap-2 px-4 py-1.5 mb-8 border border-[#0f1923] bg-[#080b0f]/80 rounded-full backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] live-pulse" />
          <span className="text-[8px] text-[#22c55e] tracking-[2.5px]" style={MONO}>SYSTEM ONLINE</span>
          <span className="w-px h-3 bg-[#1e2a3a]" />
          <span className="text-[8px] text-[#2a3a4a] tracking-[1.5px]" style={MONO}>NSE · BSE</span>
        </div>

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-[58px] leading-none tracking-[2px] mb-1" style={BEBAS}>
            <span className="text-white">NIFTY</span>
            <span style={{ color: "#0284c7" }}>.</span>
            <span style={{ color: "#ea580c" }}>ALGO</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#1e2a3a]" />
            <span className="text-[9px] tracking-[3px]" style={{ ...MONO, color: "#4a6080" }}>TRADING TERMINAL</span>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#1e2a3a]" />
          </div>
        </div>

        {/* Card */}
        <div className="w-full relative" style={{
          border: "1px solid #1e2a3a",
          background: "#080d14",
          boxShadow: "0 0 80px rgba(2,132,199,0.07), 0 0 0 1px rgba(2,132,199,0.04), 0 32px 64px rgba(0,0,0,0.5)",
        }}>
          {/* Top line */}
          <div className="h-[1.5px] w-full" style={{ background: "linear-gradient(90deg, transparent 0%, #0284c7 30%, #ea580c 70%, transparent 100%)" }} />

          {/* Corner brackets */}
          <div className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-[#0284c7]/30" />
          <div className="absolute top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-[#0284c7]/30" />
          <div className="absolute bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-[#ea580c]/30" />
          <div className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-[#ea580c]/30" />

          {/* Header */}
          <div className="px-8 pt-7 pb-5" style={{ borderBottom: "1px solid #0f1923" }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[8px] tracking-[2.5px] mb-1" style={{ ...MONO, color: "#2a3a4a" }}>AUTHENTICATION REQUIRED</div>
                <div className="text-[13px] tracking-[1px] text-white" style={MONO}>KITE CONNECT</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] tracking-[1px] mb-0.5" style={{ ...MONO, color: "#2a3a4a" }}>BROKER</div>
                <div className="text-[11px] font-bold tracking-[1.5px]" style={{ ...MONO, color: "#0284c7" }}>ZERODHA</div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-7 space-y-5">

            {/* Error */}
            {errorMsg && (
              <div className="flex gap-2.5 px-3.5 py-2.5 text-[9px] text-[#ef4444]" style={{
                ...MONO, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.04)",
              }}>
                <span className="mt-px">⚠</span>
                <span>{decodeURIComponent(errorMsg)}</span>
              </div>
            )}

            {/* Connect via Kite */}
            <div>
              <div className="text-[8px] tracking-[2px] mb-2" style={{ ...MONO, color: "#2a3a4a" }}>
                METHOD 1 — BROWSER AUTH
              </div>
              <button onClick={handleConnect} disabled={connecting}
                className="w-full py-3.5 flex items-center justify-center gap-3 text-[11px] tracking-[3px] font-bold cursor-pointer disabled:opacity-50 transition-all"
                style={{
                  ...MONO,
                  background: "rgba(234,88,12,0.09)",
                  border: "1px solid #ea580c",
                  color: "#ea580c",
                  boxShadow: "0 0 24px rgba(234,88,12,0.06)",
                }}>
                {connecting
                  ? <><span className="w-3 h-3 rounded-full border border-[#ea580c] border-t-transparent animate-spin" />CONNECTING…</>
                  : <>⚡ CONNECT KITE</>}
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-[#0f1923]" />
              <span className="text-[8px] tracking-[1px]" style={{ ...MONO, color: "#1e2a3a" }}>OR</span>
              <div className="flex-1 h-px bg-[#0f1923]" />
            </div>

            {/* Manual token */}
            <div>
              <div className="text-[8px] tracking-[2px] mb-2" style={{ ...MONO, color: "#2a3a4a" }}>
                METHOD 2 — MANUAL TOKEN
              </div>
              <ManualTokenEntry onConnected={onConnected} />
            </div>

          </div>

          {/* Bottom line */}
          <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, #0f1923, transparent)" }} />
        </div>

        {/* Footer stats */}
        <div className="w-full mt-4 grid grid-cols-3 gap-[1px]" style={{ background: "#0f1923" }}>
          {[
            { label: "SESSION",  val: "REQUIRED", color: "#ea580c" },
            { label: "API VER",  val: "v3",        color: "#0284c7" },
            { label: "EXCHANGE", val: "NSE/BSE",   color: "#22c55e" },
          ].map(({ label, val, color }) => (
            <div key={label} className="px-4 py-2.5 text-center" style={{ background: "#080b0f" }}>
              <div className="text-[7px] tracking-[1.5px] mb-1" style={{ ...MONO, color: "#2a3a4a" }}>{label}</div>
              <div className="text-[10px] font-bold tracking-[1px]" style={{ ...MONO, color }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Bottom label */}
        <div className="mt-5 text-center text-[8px] tracking-[2px]" style={{ ...MONO, color: "#1e2a3a" }}>
          POWERED BY ZERODHA · KITE CONNECT API
        </div>
      </div>
    </div>
  );
}

function ManualTokenEntry({ onConnected }: { onConnected: (u: string) => void }) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = (e.currentTarget.elements.namedItem("token") as HTMLInputElement).value.trim();
    if (!token) return;
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      const data = await res.json();
      if (data.success) onConnected("Manual");
      else alert(data.error || "Invalid token");
    } catch {
      alert("Cannot reach backend");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2" style={MONO}>
      <input name="token" type="text" placeholder="paste access token…"
        className="flex-1 px-3 py-2.5 text-[10px] outline-none transition-colors"
        style={{
          background: "#040810",
          border: "1px solid #1e2a3a",
          color: "#e2e8f0",
          fontFamily: "'Space Mono', monospace",
        }}
        onFocus={e => (e.target.style.borderColor = "#0284c7")}
        onBlur={e  => (e.target.style.borderColor = "#1e2a3a")}
      />
      <button type="submit" disabled={loading}
        className="px-5 py-2.5 text-[10px] tracking-[1.5px] font-bold cursor-pointer disabled:opacity-50 transition-all"
        style={{
          background: "rgba(2,132,199,0.08)",
          border: "1px solid #1e2a3a",
          color: "#0284c7",
          fontFamily: "'Space Mono', monospace",
        }}>
        {loading ? "…" : "SET"}
      </button>
    </form>
  );
}
