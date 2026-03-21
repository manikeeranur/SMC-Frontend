"use client";
import { useEffect, useState } from "react";

interface Props { connected: boolean; demoMode: boolean; }

export function Header({ connected, demoMode }: Props) {
  const [time, setTime] = useState("--:--:--");
  useEffect(() => {
    const upd = () => setTime(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    upd();
    const id = setInterval(upd, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex items-center justify-between px-6 h-[52px] border-b border-[#1e2d3d] bg-[#0d1117] flex-shrink-0">
      <div className="flex items-center gap-4">
        <div className="text-[22px] tracking-[4px] text-[#00d4ff]"
          style={{ fontFamily:"'Bebas Neue',sans-serif", textShadow:"0 0 18px rgba(0,212,255,0.35)" }}>
          NIFTY<span className="text-[#ff6b35]">.</span>OPTIONS
        </div>
      </div>
      <div className="flex items-center gap-5">
        {demoMode && (
          <span className="text-[9px] tracking-[2px] text-[#ff6b35] border border-[#ff6b35]/30 px-2 py-0.5 rounded-sm"
            style={{ fontFamily:"'Space Mono',monospace" }}>DEMO</span>
        )}
        <span className="text-[12px] text-[#00d4ff]" style={{ fontFamily:"'Space Mono',monospace" }}>{time}</span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-[#00e676] live-pulse" : "bg-[#4a6080]"}`} />
          <span className="text-[10px] text-[#4a6080]" style={{ fontFamily:"'Space Mono',monospace" }}>
            {connected ? "LIVE" : "DEMO"}
          </span>
        </div>
      </div>
    </header>
  );
}
