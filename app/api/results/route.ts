import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DIRS = {
  backtest: "BacktestResultsDateWise",
  live:     "liveAlertsDateWise",
};

function listDates(type: "backtest" | "live"): string[] {
  const dir = path.join(process.cwd(), "public", DIRS[type]);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".csv"))
    .map(f => f.replace(".csv", ""))
    .sort()
    .reverse();
}

function parseCSV(filePath: string): Record<string, string>[] {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const vals: string[] = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? "").trim(); });
    return row;
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") ?? "backtest") as "backtest" | "live";
  const date = searchParams.get("date");

  // List available dates
  if (!date) {
    return NextResponse.json({
      backtest: listDates("backtest"),
      live:     listDates("live"),
    });
  }

  const filePath = path.join(process.cwd(), "public", DIRS[type], `${date}.csv`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const rows = parseCSV(filePath);
  return NextResponse.json({ date, type, rows });
}
