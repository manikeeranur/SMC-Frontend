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
    const { alerts, date } = await req.json();
    if (!alerts?.length || !date) return NextResponse.json({ ok: false, reason: "no data" });

    const dir = path.join(process.cwd(), "public", "liveAlertsDateWise");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const header = "Date,EntryTime,ExitTime,Direction,Strike,Entry,SL,Target1,Target2,Status,T1Hit,T1HitTime,PnL,PnLPct,Strength,Concepts,Expiry\n";
    const rows = alerts.map((a: any) => [
      esc(date),
      esc(a.entryTime),
      esc(a.exitTime),
      esc(a.direction),
      esc(a.strike),
      esc(a.rr?.entry),
      esc(a.rr?.sl),
      esc(a.rr?.target1),
      esc(a.rr?.target2),
      esc(a.status),
      a.t1Hit ? "Y" : "N",
      esc(a.t1HitTime),
      esc(a.currentPnL),
      esc(a.pnlPct),
      esc(a.strength),
      esc((a.concepts ?? []).join("+")),
      esc(a.expiry),
    ].join(",")).join("\n");

    fs.writeFileSync(path.join(dir, `${date}.csv`), header + rows, "utf8");
    return NextResponse.json({ ok: true, file: `liveAlertsDateWise/${date}.csv`, count: alerts.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
