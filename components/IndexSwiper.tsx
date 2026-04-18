"use client";

import { useEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode } from "swiper/modules";
import "swiper/css";
import "swiper/css/free-mode";
import { optionsApi } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { IconTallymark1 } from "@tabler/icons-react";

const MONO = { fontFamily: "'Space Mono', monospace" } as const;

const INDEX_META: Record<
  string,
  { label: string; short: string; token: number; exchange: "NSE" | "BSE" }
> = {
  "NSE:NIFTY 50": {
    label: "NIFTY 50",
    short: "N50",
    token: 256265,
    exchange: "NSE",
  },
  "BSE:SENSEX": { label: "SENSEX", short: "SX", token: 265, exchange: "BSE" },
  "NSE:NIFTY BANK": {
    label: "BANK NIFTY",
    short: "BNK",
    token: 260105,
    exchange: "NSE",
  },
  "NSE:NIFTY FIN SERVICE": {
    label: "FIN NIFTY",
    short: "FIN",
    token: 257801,
    exchange: "NSE",
  },
  "NSE:NIFTY MID SELECT": {
    label: "MIDCAP NIFTY",
    short: "MID",
    token: 288009,
    exchange: "NSE",
  },
  "NSE:NIFTY NEXT 50": {
    label: "NIFTY NXT 50",
    short: "NXT",
    token: 270857,
    exchange: "NSE",
  },
  "BSE:BANKEX": {
    label: "BANKEX",
    short: "BKX",
    token: 274441,
    exchange: "BSE",
  },
  "NSE:INDIA VIX": {
    label: "INDIA VIX",
    short: "VIX",
    token: 264969,
    exchange: "NSE",
  },
};

interface IndexData {
  key: string;
  ltp: number;
  prevClose: number;
  ltpChange: number;
}

interface Props {
  onOpenChart: (
    token: number,
    tradingsymbol: string,
    exchange: "NSE" | "BSE",
  ) => void;
}

export default function IndexSwiper({ onOpenChart }: Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [indices, setIndices] = useState<IndexData[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    async function fetch() {
      try {
        const { indices: data } = await optionsApi.indexQuotes();
        setIndices(data);
      } catch {}
    }
    fetch();
    timerRef.current = setInterval(fetch, 500);
    return () => clearInterval(timerRef.current);
  }, []);

  const bg = isDark ? "#0d1420" : "#fff";
  const border = isDark ? "#1e2a3a" : "#e2e8f0";
  const txtPri = isDark ? "#e2e8f0" : "#1e293b";
  const txtMut = isDark ? "#64748b" : "#94a3b8";

  return (
    <div className="px-3 pt-3 pb-1">
      <Swiper
        modules={[FreeMode]}
        freeMode
        slidesPerView="auto"
        spaceBetween={8}
        className="!overflow-visible"
      >
        {indices.map((idx) => {
          const meta = INDEX_META[idx.key];
          if (!meta) return null;
          const up = idx.ltpChange >= 0;
          const clr = up ? "#16a34a" : "#e11d48";
          const pct =
            idx.prevClose > 0 ? (idx.ltpChange / idx.prevClose) * 100 : 0;

          return (
            <SwiperSlide key={idx.key} style={{ width: "auto" }}>
              <button
                onClick={() =>
                  onOpenChart(
                    meta.token,
                    meta.label.replace(/\s+/g, ""),
                    meta.exchange,
                  )
                }
                className="flex flex-col gap-0.5 px-3 py-2 rounded-xl cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: bg,
                  border: `1px solid ${border}`,
                  minWidth: 110,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[9px] font-black truncate"
                    style={{ ...MONO, color: txtPri }}
                  >
                    {meta.label}
                  </span>
                  <span
                    className="text-[7px] px-1 py-0.5 rounded font-bold flex-shrink-0"
                    style={{
                      background: isDark ? "#1e2a3a" : "#f1f5f9",
                      color: txtMut,
                    }}
                  >
                    {meta.exchange}
                  </span>
                </div>
                <span
                  className="text-[13px] font-black tabular-nums leading-tight text-start"
                  style={{ ...MONO, color: txtPri }}
                >
                  {idx.ltp > 0
                    ? idx.ltp.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </span>
                <div className="flex items-center gap-1">
                  <span
                    className="text-[9px] font-bold tabular-nums"
                    style={{ ...MONO, color: clr }}
                  >
                    {up ? "▲" : "▼"} {Math.abs(idx.ltpChange).toFixed(2)}
                  </span>
                  <IconTallymark1 className="size-3"/>
                  <span
                    className="text-[8px] font-bold tabular-nums"
                    style={{ ...MONO, color: clr }}
                  >
                    ({Math.abs(pct).toFixed(2)}%)
                  </span>
                </div>
              </button>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
}
