"use client";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;
const API   = process.env.NEXT_PUBLIC_API_URL || "https://smc-backend-yheu.onrender.com";

interface Props {
  onConnected: (userName: string) => void;
  errorMsg?:   string;
}

export function KiteAuth({ onConnected, errorMsg }: Props) {

  async function handleConnect() {
    try {
      const res  = await fetch(`${API}/api/auth/login`);
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      window.location.href = data.loginUrl;
    } catch {
      alert(`Cannot reach backend at ${API}`);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#f0f4f8] gap-8">
      {/* Logo */}
      <div className="text-center">
        <div className="text-[48px] tracking-[6px] text-[#0284c7]"
          style={{ ...BEBAS }}>
          NIFTY<span className="text-[#ea580c]">.</span>OPTIONS
        </div>
        <div className="text-[11px] tracking-[3px] text-[#64748b] mt-1" style={MONO}>
          9:26 AM SCANNER  ·  LIVE OPTION CHAIN  ·  RR 1:2.5
        </div>
      </div>

      {/* Auth card */}
      <div className="w-[420px] bg-white border border-[#cbd5e1] rounded-sm overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-[#cbd5e1]" style={{ background: "rgba(2,132,199,0.05)" }}>
          <div className="text-[16px] tracking-[2px] text-[#0284c7]" style={BEBAS}>CONNECT KITE ACCOUNT</div>
          <div className="text-[10px] text-[#64748b] mt-0.5" style={MONO}>Required for live option chain data</div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {errorMsg && (
            <div className="px-3 py-2.5 border border-[#e11d48]/40 bg-[#e11d48]/5 rounded-sm">
              <div className="text-[10px] text-[#e11d48]" style={MONO}>
                ✗ {decodeURIComponent(errorMsg)}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {[
              { n:"1", text:"Open backend/.env and add your KITE_API_KEY and KITE_API_SECRET" },
              { n:"2", text:`Set Redirect URL in Kite app to:  ${API}/api/auth/callback` },
              { n:"3", text:"Click Connect below — login with your Zerodha credentials" },
            ].map(({ n, text }) => (
              <div key={n} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-[#f1f5f9] border border-[#cbd5e1] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[9px] text-[#64748b]" style={MONO}>{n}</span>
                </div>
                <div className="text-[10px] text-[#334155] leading-relaxed" style={MONO}>{text}</div>
              </div>
            ))}
          </div>

          <div className="px-3 py-2 bg-[#f1f5f9] border border-[#cbd5e1] rounded-sm">
            <div className="text-[8px] text-[#64748b] mb-1 tracking-[1.5px]" style={MONO}>KITE APP REDIRECT URL</div>
            <div className="text-[11px] text-[#0284c7]" style={MONO}>{API}/api/auth/callback</div>
          </div>

          <button onClick={handleConnect}
            className="w-full py-3 text-[12px] font-bold tracking-[3px] bg-[#ea580c]/10 border border-[#ea580c] text-[#ea580c] rounded-sm cursor-pointer hover:bg-[#ea580c]/20 transition-colors"
            style={MONO}>
            ⚡ CONNECT KITE
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#cbd5e1]" />
            <span className="text-[9px] text-[#94a3b8]" style={MONO}>OR</span>
            <div className="flex-1 h-px bg-[#cbd5e1]" />
          </div>

          <ManualTokenEntry onConnected={onConnected} />
        </div>
      </div>

      <div className="text-[9px] text-[#94a3b8] text-center" style={MONO}>
        Powered by Kite Connect API  ·  Zerodha
      </div>
    </div>
  );
}

function ManualTokenEntry({ onConnected }: { onConnected: (u: string) => void }) {
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = (e.currentTarget.elements.namedItem("token") as HTMLInputElement).value.trim();
    if (!token) return;
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
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="text-[9px] text-[#64748b] tracking-[1.5px]" style={MONO}>
        PASTE ACCESS TOKEN MANUALLY
      </div>
      <div className="flex gap-2">
        <input name="token" type="text" placeholder="access_token from Kite session"
          className="flex-1 bg-[#f1f5f9] border border-[#cbd5e1] text-[#334155] px-3 py-2 text-[10px] rounded-sm outline-none focus:border-[#0284c7]"
          style={MONO} />
        <button type="submit"
          className="px-3 py-2 text-[10px] bg-[#0284c7]/10 border border-[#0284c7]/40 text-[#0284c7] rounded-sm cursor-pointer hover:bg-[#0284c7]/20"
          style={MONO}>
          SET
        </button>
      </div>
    </form>
  );
}
