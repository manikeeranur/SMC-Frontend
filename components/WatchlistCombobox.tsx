"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { searchApi } from "@/lib/api";
import { IconPlus, IconBookmarkFilled, IconSearch, IconLoader2, IconX } from "@tabler/icons-react";
import type { OptionLeg, OptionsRow } from "@/lib/options";
import { fmtOI } from "@/lib/options";

const MONO = { fontFamily: "'Space Mono', monospace" } as const;

export interface SearchResult {
  token: number;
  tradingsymbol: string;
  name: string;
  exchange: string;
  type: "EQ" | "CE" | "PE";
  ltp: number;
  strike?: number;
  oi?: number;
  iv?: number;
  pct?: number;
  isOption?: boolean;
  index?: "NIFTY" | "SENSEX";
}

interface Props {
  chainRows: OptionsRow[];
  chainIndex: "NIFTY" | "SENSEX";
  expiry: string;
  watchedTokens: Set<number>;
  onAdd: (result: SearchResult) => void;
  onRemove: (token: number) => void;
  isDemoMode?: boolean;
}

// Stock logo with auto-fallback to letter avatar
function StockLogo({ symbol, name, size = 36 }: { symbol: string; name?: string; size?: number }) {
  const [err, setErr] = useState(false);
  const letter = (symbol || "?")[0].toUpperCase();
  const colors = ["#0284c7", "#16a34a", "#7c3aed", "#ea580c", "#db2777", "#0891b2", "#b45309"];
  const color = colors[letter.charCodeAt(0) % colors.length];

  if (err) {
    return (
      <div
        className="rounded-full flex-shrink-0 flex items-center justify-center font-black text-white"
        style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      >
        {(symbol || "?").slice(0, 2)}
      </div>
    );
  }

  return (
    <div
      className="rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center bg-white"
      style={{ width: size, height: size, border: `1.5px solid #e2e8f0` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://images.smallcase.com/smallplug-v2/200/${symbol}.png`}
        alt={name || symbol}
        onError={() => setErr(true)}
        className="w-full h-full object-contain p-0.5"
      />
    </div>
  );
}

function OptionLogo({ index, type, size = 36 }: { index: "NIFTY" | "SENSEX"; type: "CE" | "PE"; size?: number }) {
  const dirClr = type === "CE" ? "#0284c7" : "#e11d48";
  const src = index === "SENSEX" ? "/sensex-logo.avif" : "/nifty-logo.png";
  return (
    <div
      className="rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
      style={{ width: size, height: size, border: `2px solid ${dirClr}`, background: "#111" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={index} className="w-full h-full object-cover" />
    </div>
  );
}

const INITIAL_SHOW = 5;

export default function WatchlistCombobox({
  chainRows, chainIndex, expiry, watchedTokens, onAdd, onRemove, isDemoMode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [apiResults, setApiResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAllChain, setShowAllChain] = useState(false);
  const [showAllApi, setShowAllApi] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // Build option suggestions from current chain data
  const q = query.trim().toUpperCase();
  const chainSuggestions: SearchResult[] = [];
  if (chainRows.length) {
    const mid = Math.floor(chainRows.length / 2);
    const queryMatchesChain = !q || chainIndex.includes(q);
    chainRows.forEach((row, idx) => {
      [row.ce, row.pe].forEach((leg: OptionLeg) => {
        const strikeStr = `${row.strike}`;
        const combined = `${chainIndex}${strikeStr}`;
        const isNearATM = Math.abs(idx - mid) <= 2;
        const match =
          !q ||
          (isNearATM && queryMatchesChain) ||   // ATM only when query matches this chain
          strikeStr.includes(q) ||
          leg.type.includes(q) ||
          (q === "CALL" && leg.type === "CE") ||
          (q === "PUT" && leg.type === "PE") ||
          chainIndex.includes(q) ||
          combined.includes(q.replace(/\s/g, ""));
        if (match) {
          const pct = leg.prevLtp > 0 ? ((leg.ltpChange ?? 0) / leg.prevLtp) * 100 : 0;
          chainSuggestions.push({
            token: leg.token,
            tradingsymbol: leg.tradingsymbol ?? `${chainIndex}${row.strike}${leg.type}`,
            name: `${chainIndex} ${row.strike} ${leg.type === "CE" ? "Call" : "Put"}`,
            exchange: chainIndex === "SENSEX" ? "BFO" : "NFO",
            type: leg.type as "CE" | "PE",
            ltp: leg.ltp, strike: row.strike, oi: leg.oi, iv: leg.iv, pct,
            isOption: true, index: chainIndex,
          });
        }
      });
    });
  }
  // Always exclude already-watched tokens so user doesn't see duplicates
  const visibleChainAll = chainSuggestions.filter(r => !watchedTokens.has(r.token));
  const filteredChain = showAllChain ? visibleChainAll : visibleChainAll.slice(0, INITIAL_SHOW);
  const chainHasMore = visibleChainAll.length > INITIAL_SHOW && !showAllChain;

  // API results: exclude already-watched
  const visibleApiAll = q
    ? apiResults.filter(r => !watchedTokens.has(r.token))
    : apiResults.filter(r => !watchedTokens.has(r.token));
  const filteredApi = showAllApi ? visibleApiAll : visibleApiAll.slice(0, INITIAL_SHOW);
  const apiHasMore = visibleApiAll.length > INITIAL_SHOW && !showAllApi;

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    setShowAllChain(false);
    setShowAllApi(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim() || isDemoMode) { setApiResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { results } = await searchApi.instruments(val.trim());
        setApiResults(results.map(r => ({ ...r, type: r.type as "EQ", isOption: false })));
      } catch { setApiResults([]); }
      finally { setLoading(false); }
    }, 350);
  }, [isDemoMode]);

  // Focus input when popover opens; reset on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setApiResults([]);
      setShowAllChain(false);
      setShowAllApi(false);
    }
  }, [open]);

  const handleClick = (result: SearchResult, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (watchedTokens.has(result.token)) {
      onRemove(result.token);
    } else {
      onAdd(result);
    }
    // Keep dropdown open so user can add more
  };

  const hasResults = visibleChainAll.length > 0 || loading || visibleApiAll.length > 0;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors w-full lg:w-[25vw]"
          style={{ ...MONO, border: "1px solid #0284c7", background: open ? "#0284c7" : "#e8f4ff", color: open ? "#fff" : "#0284c7" }}
        >
          <IconSearch size={13} />
          <span className="flex-1 text-left">Search stocks &amp; options…</span>
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-xl shadow-2xl outline-none"
          style={{
            width: "max(25vw, 300px)",
            border: "1px solid #e2e8f0",
            background: "#fff",
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
          }}
          onOpenAutoFocus={e => e.preventDefault()}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid #f1f5f9" }}>
            <IconSearch size={14} color="#94a3b8" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder={`BHEL, RVNL, NIFTY22300, CE…`}
              className="flex-1 bg-transparent outline-none text-[12px]"
              style={{ ...MONO, color: "#1e293b" }}
              onKeyDown={e => e.key === "Escape" && setOpen(false)}
            />
            {query && (
              <button onClick={() => { setQuery(""); setApiResults([]); inputRef.current?.focus(); }}
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "#f1f5f9", color: "#64748b" }}>
                <IconX size={10} />
              </button>
            )}
          </div>

          {/* Results list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {/* Options section */}
            {visibleChainAll.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[8px] font-bold uppercase tracking-[1.5px]"
                  style={{ ...MONO, color: "#94a3b8", borderBottom: "1px solid #f8fafc" }}>
                  {chainIndex} Options · {expiry}
                </div>
                {filteredChain.map(r => {
                  const dirClr = r.type === "CE" ? "#0284c7" : "#e11d48";
                  return (
                    <button key={`opt-${r.token}`} onClick={e => handleClick(r, e)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f0f9ff] active:bg-[#dbeafe]"
                      style={{ borderBottom: "1px solid #f8fafc" }}>
                      <OptionLogo index={r.index!} type={r.type as "CE" | "PE"} size={34} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[11px]" style={{ ...MONO, color: "#1e293b" }}>{r.index} {r.strike}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: `${dirClr}15`, color: dirClr }}>
                            {r.type === "CE" ? "Call" : "Put"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[12px] font-bold tabular-nums" style={{ ...MONO, color: "#1e293b" }}>₹{r.ltp.toFixed(2)}</span>
                          {r.pct !== undefined && (
                            <span className="text-[9px] font-bold" style={{ ...MONO, color: (r.pct ?? 0) >= 0 ? "#16a34a" : "#e11d48" }}>
                              {(r.pct ?? 0) >= 0 ? "+" : ""}{r.pct?.toFixed(2)}%
                            </span>
                          )}
                          {r.oi !== undefined && <span className="text-[8px]" style={{ ...MONO, color: "#94a3b8" }}>OI {fmtOI(r.oi)}</span>}
                          {r.iv !== undefined && <span className="text-[8px]" style={{ ...MONO, color: "#94a3b8" }}>IV {r.iv?.toFixed(1)}%</span>}
                        </div>
                      </div>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{ background: "#0284c715", color: "#0284c7" }}>
                        <IconPlus size={13} />
                      </div>
                    </button>
                  );
                })}
                {chainHasMore && (
                  <button onClick={() => setShowAllChain(true)}
                    className="w-full px-3 py-2 text-center text-[10px] font-bold transition-colors hover:bg-[#f0f9ff]"
                    style={{ ...MONO, color: "#0284c7", borderTop: "1px solid #f1f5f9" }}>
                    Show {visibleChainAll.length - INITIAL_SHOW} more options →
                  </button>
                )}
              </div>
            )}

            {/* NSE Stocks section */}
            {(loading || visibleApiAll.length > 0) && (
              <div>
                {visibleChainAll.length > 0 && <div style={{ height: 1, background: "#e2e8f0" }} />}
                <div className="px-3 py-1.5 text-[8px] font-bold uppercase tracking-[1.5px]"
                  style={{ ...MONO, color: "#94a3b8", borderBottom: "1px solid #f8fafc" }}>
                  Stocks
                </div>
                {loading && (
                  <div className="flex items-center gap-2 px-3 py-4 text-[11px]" style={{ ...MONO, color: "#94a3b8" }}>
                    <IconLoader2 size={14} className="animate-spin" />
                    Searching…
                  </div>
                )}
                {!loading && filteredApi.map(r => (
                  <button key={`eq-${r.token}`} onClick={e => handleClick(r, e)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f0fff4] active:bg-[#dcfce7]"
                    style={{ borderBottom: "1px solid #f8fafc" }}>
                    <StockLogo symbol={r.tradingsymbol} name={r.name} size={34} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[11px]" style={{ ...MONO, color: "#1e293b" }}>{r.tradingsymbol}</span>
                        <span className="text-[8px] px-1 py-0.5 rounded font-bold" style={{ background: "#f1f5f9", color: "#64748b" }}>{r.exchange}</span>
                      </div>
                      <div className="text-[9px] truncate" style={{ ...MONO, color: "#64748b" }}>{r.name}</div>
                      {r.ltp > 0 && (
                        <span className="text-[11px] font-bold tabular-nums" style={{ ...MONO, color: "#1e293b" }}>₹{r.ltp.toFixed(2)}</span>
                      )}
                    </div>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: "#16a34a15", color: "#16a34a" }}>
                      <IconPlus size={13} />
                    </div>
                  </button>
                ))}
                {!loading && apiHasMore && (
                  <button onClick={() => setShowAllApi(true)}
                    className="w-full px-3 py-2 text-center text-[10px] font-bold transition-colors hover:bg-[#f0fff4]"
                    style={{ ...MONO, color: "#16a34a", borderTop: "1px solid #f1f5f9" }}>
                    Show {visibleApiAll.length - INITIAL_SHOW} more stocks →
                  </button>
                )}
              </div>
            )}

            {/* Empty state */}
            {!loading && query.length > 0 && !hasResults && (
              <div className="px-3 py-8 text-center text-[11px]" style={{ ...MONO, color: "#94a3b8" }}>
                No results for &quot;{query}&quot;
              </div>
            )}

            {/* Hint when empty query */}
            {!query && !hasResults && (
              <div className="px-3 py-6 text-center text-[10px]" style={{ ...MONO, color: "#cbd5e1" }}>
                Type stock name or option strike
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
