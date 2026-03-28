"use client";

import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/lib/theme";
import { IconArrowLeft } from "@tabler/icons-react";
import { ResultsContent } from "@/components/ResultsContent";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;

export default function ResultsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col bg-[#080b0f] text-[#e2e8f0]" style={MONO}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#1e2a3a] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/options")}
            className="flex items-center gap-1 text-[10px] text-[#64748b] hover:text-[#94a3b8] cursor-pointer"
            style={MONO}>
            <IconArrowLeft size={13} /> BACK
          </button>
          <span className="text-[14px] sm:text-[16px] text-[#e2e8f0] tracking-[2px] sm:tracking-[3px]"
            style={BEBAS}>RESULTS</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:block text-[9px] text-[#4a6080]" style={MONO}>SMC ALGO · RESULTS</span>
          <ThemeToggle />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ResultsContent />
      </div>
    </div>
  );
}
