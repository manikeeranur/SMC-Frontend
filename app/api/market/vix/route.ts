import { NextResponse } from "next/server";

const VIX_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=1d&range=1d";

export async function GET() {
  try {
    const res = await fetch(VIX_URL, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch VIX data" },
        { status: res.status },
      );
    }

    const data = await res.json();
    const value = data?.chart?.result?.[0]?.meta?.regularMarketPrice;

    return NextResponse.json(
      { value: typeof value === "number" ? value : null },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch VIX data" },
      { status: 500 },
    );
  }
}
