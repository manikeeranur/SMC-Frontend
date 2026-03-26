"use client";

import { useState } from "react";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;
const API   = process.env.NEXT_PUBLIC_API_URL || "https://13.61.175.6:4000";

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
    <div className="flex items-center justify-center min-h-screen bg-[#080b0f]"
      style={{ backgroundImage: "radial-gradient(ellipse at 50% 40%, rgba(2,132,199,0.06) 0%, transparent 70%)" }}>

      <div className="w-[360px]">
        {/* Card */}
        <div className="relative border border-[#1e2a3a] bg-[#0a0f16] overflow-hidden"
          style={{ boxShadow: "0 0 40px rgba(2,132,199,0.08), 0 0 0 1px rgba(2,132,199,0.05)" }}>

          {/* Top accent line */}
          <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, transparent, #0284c7, #ea580c, transparent)" }} />

          {/* Corner decorations */}
          <div className="absolute top-3 left-3 w-3 h-3 border-t border-l border-[#0284c7]/40" />
          <div className="absolute top-3 right-3 w-3 h-3 border-t border-r border-[#0284c7]/40" />
          <div className="absolute bottom-3 left-3 w-3 h-3 border-b border-l border-[#0284c7]/40" />
          <div className="absolute bottom-3 right-3 w-3 h-3 border-b border-r border-[#0284c7]/40" />

          {/* Card header */}
          <div className="px-8 pt-8 pb-5 border-b border-[#1e2a3a]" style={MONO}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[#4a6080] tracking-[2px]">SYSTEM AUTH</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                <span className="text-[8px] text-[#22c55e] tracking-[1px]">ONLINE</span>
              </span>
            </div>
            <div className="text-[11px] text-[#e2e8f0] tracking-[1px]">KITE CONNECT</div>
            <div className="text-[8px] text-[#2a3a4a] mt-0.5 tracking-[1px]">ZERODHA · SESSION REQUIRED</div>
          </div>

          <div className="px-8 py-6 space-y-4" style={MONO}>

            {/* Error */}
            {errorMsg && (
              <div className="flex gap-2 px-3 py-2 border border-[#ef4444]/30 bg-[#ef4444]/5 text-[9px] text-[#ef4444]">
                <span>✗</span><span>{decodeURIComponent(errorMsg)}</span>
              </div>
            )}

            {/* Connect button */}
            <button onClick={handleConnect} disabled={connecting}
              className="w-full py-3 flex items-center justify-center gap-2 text-[10px] tracking-[2px] border cursor-pointer disabled:opacity-60 transition-all hover:bg-[#ea580c]/15"
              style={{ background: "rgba(234,88,12,0.08)", borderColor: "#ea580c", color: "#ea580c" }}>
              {connecting
                ? <><span className="w-3 h-3 border border-[#ea580c] border-t-transparent rounded-full animate-spin" />CONNECTING…</>
                : "⚡ CONNECT KITE"}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#1e2a3a]" />
              <span className="text-[8px] text-[#2a3a4a]">OR</span>
              <div className="flex-1 h-px bg-[#1e2a3a]" />
            </div>

            {/* Manual token */}
            <ManualTokenEntry onConnected={onConnected} />

          </div>
        </div>

        {/* Bottom label */}
        <div className="text-center mt-4 text-[8px] text-[#2a3a4a] tracking-[2px]" style={MONO}>
          ZERODHA · KITE CONNECT API
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
    <form onSubmit={handleSubmit} className="space-y-2" style={MONO}>
      <div className="text-[8px] text-[#4a6080] tracking-[1.5px]">ACCESS TOKEN</div>
      <div className="flex gap-2">
        <input name="token" type="text" placeholder="paste token…"
          className="flex-1 bg-[#080b0f] border border-[#1e2a3a] text-[#e2e8f0] px-3 py-2 text-[10px] outline-none focus:border-[#0284c7] placeholder:text-[#2a3a4a] transition-colors"
          style={MONO} />
        <button type="submit" disabled={loading}
          className="px-4 py-2 text-[10px] tracking-[1px] border cursor-pointer disabled:opacity-50 hover:bg-[#0284c7]/15 transition-all"
          style={{ background: "rgba(2,132,199,0.06)", borderColor: "#1e2a3a", color: "#0284c7" }}>
          {loading ? "…" : "SET"}
        </button>
      </div>
    </form>
  );
}
