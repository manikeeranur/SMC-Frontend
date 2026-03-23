"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://smc-backend-yheu.onrender.com";

interface Props {
  onConnected: (userName: string) => void;
  errorMsg?:   string;
}

export function KiteAuth({ onConnected, errorMsg }: Props) {
  const [token,   setToken]   = useState("");
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [err,     setErr]     = useState(errorMsg ?? "");

  async function handleKiteLogin() {
    setLoading(true);
    setLoadMsg("Connecting to Kite...");
    setErr("");
    try {
      const res  = await fetch(`${API}/api/auth/login`);
      const data = await res.json();
      if (data.error) { setErr(data.error); setLoading(false); return; }
      setLoadMsg("Redirecting to Zerodha...");
      window.location.href = data.loginUrl;
    } catch {
      setErr(`Cannot reach backend at ${API}`);
      setLoading(false);
    }
  }

  async function handleTokenConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setLoadMsg("Verifying token...");
    setErr("");
    try {
      const res  = await fetch(`${API}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setLoadMsg("Authenticated! Loading dashboard...");
        setTimeout(() => onConnected("Manual"), 900);
      } else {
        setErr(data.error || "Invalid token");
        setLoading(false);
      }
    } catch {
      setErr("Cannot reach backend");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 py-8 overflow-hidden"
      style={{ background: "#0d1117" }}>

      {/* Dot grid texture */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.022) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }} />
      {/* Faint blue glow from center */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 70% 55% at 50% 48%, rgba(2,132,199,0.07) 0%, transparent 70%)",
      }} />

      {/* ── LOADING OVERLAY ── */}
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6"
          style={{ background: "rgba(13,17,23,0.92)", backdropFilter: "blur(10px)" }}>
          {/* Double spinner */}
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full" style={{ border:"2px solid #21262d" }} />
            <div className="absolute inset-0 rounded-full animate-spin"
              style={{ border:"2px solid transparent", borderTopColor:"#0284c7" }} />
            <div className="absolute inset-[5px] rounded-full animate-spin"
              style={{ border:"2px solid transparent", borderTopColor:"#ea580c", animationDirection:"reverse", animationDuration:"0.65s" }} />
            {/* Center dot */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-[#0284c7]" style={{ boxShadow:"0 0 8px #0284c7" }} />
            </div>
          </div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, letterSpacing:3, color:"#6e7681" }}>
            {loadMsg.toUpperCase()}
          </div>
        </div>
      )}

      {/* ── CARD ── */}
      <div className="relative z-10 w-full max-w-[400px]">

        {/* Card */}
        <div className="rounded-2xl overflow-hidden" style={{
          background: "linear-gradient(160deg, #1c2128 0%, #161b22 100%)",
          border: "1px solid #30363d",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.03) inset, 0 20px 60px rgba(0,0,0,0.55)",
        }}>

          {/* Card top accent bar */}
          <div className="h-[2px]" style={{
            background: "linear-gradient(90deg, #0284c7 0%, #ea580c 50%, transparent 100%)",
          }} />

          <div className="px-6 md:px-8 py-7 space-y-5">

            {/* Error */}
            {err && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-[11px]"
                style={{ background:"rgba(225,29,72,0.10)", border:"1px solid rgba(225,29,72,0.28)", color:"#fca5a5", fontFamily:"'Space Mono',monospace" }}>
                <span className="flex-shrink-0 mt-px">⚠</span>
                <span>{decodeURIComponent(err)}</span>
              </div>
            )}

            {/* ── Kite Login button ── */}
            <button onClick={handleKiteLogin} disabled={loading}
              className="w-full py-4 rounded-xl font-bold text-white text-[14px] md:text-[15px] flex items-center justify-center gap-2.5 cursor-pointer transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 40%, #ea580c 100%)",
                boxShadow: "0 4px 20px rgba(2,132,199,0.3), 0 1px 0 rgba(255,255,255,0.08) inset",
                letterSpacing: 0.5,
                fontFamily: "'DM Sans',sans-serif",
              }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Login with Application
            </button>

            {/* ── Divider ── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background:"#21262d" }} />
              <span className="px-3 py-1 rounded-lg text-[8px] tracking-[2.5px] font-bold"
                style={{ background:"#0d1117", color:"#6e7681", fontFamily:"'Space Mono',monospace", border:"1px solid #21262d" }}>
                OR MANUAL TOKEN
              </span>
              <div className="flex-1 h-px" style={{ background:"#21262d" }} />
            </div>

            {/* ── Manual token form ── */}
            <form onSubmit={handleTokenConnect} className="space-y-3">
              {/* Input */}
              <label className="block">
                <div className="text-[8px] tracking-[2px] mb-2" style={{ fontFamily:"'Space Mono',monospace", color:"#6e7681" }}>
                  ACCESS TOKEN
                </div>
                <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all"
                  style={{ background:"#0d1117", border:"1px solid #30363d" }}
                  onFocus={() => {}} /* handled by child */
                  >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6e7681" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <circle cx="8" cy="15" r="4"/><path d="m15 7-3 3"/><path d="m17 5 2 2"/><path d="m12 10 5-5"/>
                  </svg>
                  <input
                    type="text"
                    name="access_token"
                    autoComplete="on"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="Paste your Kite access token"
                    className="flex-1 bg-transparent outline-none text-[12px] md:text-[13px]"
                    style={{ fontFamily:"'Space Mono',monospace", color:"#c9d1d9", caretColor:"#0284c7" }}
                  />
                  {token && (
                    <button type="button" onClick={() => setToken("")}
                      className="flex-shrink-0 w-4 h-4 flex items-center justify-center cursor-pointer transition-opacity hover:opacity-70"
                      style={{ color:"#6e7681" }}>×</button>
                  )}
                </div>
              </label>

              {/* Connect button */}
              <button type="submit" disabled={loading || !token.trim()}
                className="w-full py-3.5 rounded-xl font-bold text-[12px] cursor-pointer transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed"
                style={{
                  background: token.trim() ? "#21262d" : "#161b22",
                  border: `1px solid ${token.trim() ? "#0284c7" : "#30363d"}`,
                  color: token.trim() ? "#58a6ff" : "#6e7681",
                  letterSpacing: 2,
                  fontFamily: "'Space Mono',monospace",
                  transition: "all 0.2s",
                }}>
                Connect with Token
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 py-3 flex items-center justify-between"
            style={{ background:"#0d1117", borderTop:"1px solid #21262d" }}>
            <span className="text-[8px] tracking-[1.5px]"
              style={{ fontFamily:"'Space Mono',monospace", color:"#484f58" }}>
              KITE CONNECT · ZERODHA
            </span>
            <span className="text-[8px] tracking-[1px]"
              style={{ fontFamily:"'Space Mono',monospace", color:"#30363d" }}>
              v2.0
            </span>
          </div>
        </div>

        {/* Below card hint */}
        <div className="mt-5 text-center text-[9px] tracking-[1px]"
          style={{ fontFamily:"'Space Mono',monospace", color:"#30363d" }}>
          Session persists until token expires
        </div>
      </div>
    </div>
  );
}
