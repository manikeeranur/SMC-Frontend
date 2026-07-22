"use client";

import { useHolidays } from "@/lib/holidays";
import { useTheme } from "@/lib/theme";

const MONO = { fontFamily: "'Space Mono', monospace" } as const;
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function dayName(dateStr: string) {
  return DAY_NAMES[new Date(dateStr + "T00:00:00").getDay()];
}

export default function HolidaysTab() {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const border  = isDark ? "#1e293b" : "#e2e8f0";
  const subtext = isDark ? "#64748b" : "#94a3b8";
  const text    = isDark ? "#e2e8f0" : "#1e293b";
  const cardBg  = isDark ? "#0f172a" : "#ffffff";

  const holidays = useHolidays();
  const today    = new Date().toISOString().split("T")[0];
  const upcoming = holidays.filter(h => h.date >= today);
  const past     = [...holidays.filter(h => h.date < today)].reverse();

  function Row({ h, dimmed }: { h: { date: string; name: string }; dimmed?: boolean }) {
    const [, mm, dd] = h.date.split("-");
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b last:border-0"
        style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9", opacity: dimmed ? 0.45 : 1 }}>
        <div className="w-11 text-center flex-shrink-0 rounded-lg py-1.5"
          style={{ background: dimmed ? (isDark ? "#1e293b" : "#f1f5f9") : "#ea580c15" }}>
          <div className="text-[15px] font-black leading-none" style={{ ...MONO, color: dimmed ? subtext : "#ea580c" }}>{dd}</div>
          <div className="text-[9px] font-bold mt-0.5" style={{ ...MONO, color: subtext }}>{MONTHS[+mm - 1]}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold truncate" style={{ color: text }}>{h.name}</div>
          <div className="text-[10px] mt-0.5" style={{ ...MONO, color: subtext }}>{dayName(h.date)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-bold tracking-[2px] uppercase" style={{ ...MONO, color: text }}>
          NSE Market Holidays
        </span>
        <span className="text-[9px] font-bold px-2 py-1 rounded-lg"
          style={{ ...MONO, background: "#ea580c15", color: "#ea580c" }}>
          {upcoming.length} upcoming
        </span>
      </div>

      {holidays.length === 0 ? (
        <div className="flex items-center justify-center h-40">
          <span className="text-[10px]" style={{ ...MONO, color: subtext }}>Loading…</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl overflow-hidden" style={{ background: cardBg, border: `1px solid ${border}` }}>
            <div className="px-4 py-2.5 border-b" style={{ borderColor: border, background: isDark ? "#0a1220" : "#f8fafc" }}>
              <span className="text-[9px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>Upcoming</span>
            </div>
            {upcoming.length > 0
              ? upcoming.map(h => <Row key={h.date} h={h} />)
              : (
                <div className="px-4 py-6 text-center">
                  <span className="text-[10px]" style={{ ...MONO, color: subtext }}>No more holidays this year</span>
                </div>
              )}
          </div>

          {past.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: cardBg, border: `1px solid ${border}` }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: border, background: isDark ? "#0a1220" : "#f8fafc" }}>
                <span className="text-[9px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>Past</span>
              </div>
              {past.map(h => <Row key={h.date} h={h} dimmed />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
