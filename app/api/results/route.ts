import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;

async function fetchFromBackend(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "backtest";
  const date = searchParams.get("date");

  if (!date) {
    try {
      const data = await fetchFromBackend(`${BACKEND}/api/results`);
      return NextResponse.json({ live: data.live ?? [], backtest: data.backtest ?? [] });
    } catch {
      return NextResponse.json({ error: "Backend unavailable" }, { status: 503 });
    }
  }

  try {
    const data = await fetchFromBackend(`${BACKEND}/api/results?type=${type}&date=${date}`);
    if (!data.rows?.length) return NextResponse.json({ error: "No data found for this date" }, { status: 404 });
    return NextResponse.json({ date, type, rows: data.rows });
  } catch {
    return NextResponse.json({ error: "No data found for this date" }, { status: 404 });
  }
}
