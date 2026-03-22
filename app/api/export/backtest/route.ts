import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function esc(v: any): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function POST(req: NextRequest) {
  try {
    const { results, date } = await req.json();
    if (!results?.length || !date) return NextResponse.json({ ok: false, reason: "no data" });

    const dir = path.join(process.cwd(), "public", "BacktestResultsDateWise");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const header = "Date,EntryTime,ExitTime,Direction,Strike,Entry,SL,Target1,Target2,Status,T1Hit,T1HitTime,PnL,PnLPct,Strength,Concepts,Expiry\n";
    const rows = results.map((r: any) => [
      esc(r.date ?? date),
      esc(r.entryTime),
      esc(r.exitTime),
      esc(r.direction),
      esc(r.strike),
      esc(r.rr?.entry),
      esc(r.rr?.sl),
      esc(r.rr?.target1),
      esc(r.rr?.target2),
      esc(r.status),
      r.t1Hit ? "Y" : "N",
      esc(r.t1HitTime),
      esc(r.currentPnL),
      esc(r.pnlPct),
      esc(r.strength),
      esc((r.concepts ?? []).join("+")),
      esc(r.expiry),
    ].join(",")).join("\n");

    fs.writeFileSync(path.join(dir, `${date}.csv`), header + rows, "utf8");
    return NextResponse.json({ ok: true, file: `BacktestResultsDateWise/${date}.csv`, count: results.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
