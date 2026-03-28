import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;

export async function GET(req: NextRequest) {
  if (!BACKEND) {
    return NextResponse.json({ error: "Backend URL not configured" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");
  const date = searchParams.get("date");

  try {
    const url = type && date
      ? `${BACKEND}/api/results?type=${type}&date=${date}`
      : `${BACKEND}/api/results`;

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      return NextResponse.json({ error: `Backend error ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 });
  }
}
