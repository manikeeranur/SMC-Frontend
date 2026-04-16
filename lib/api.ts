const API = process.env.NEXT_PUBLIC_API_URL || "http://13.61.175.6:4000";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export class AuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AuthError";
  }
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) throw new AuthError(err.error || "Session expired");
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const authApi = {
  status:   () => req<{ authenticated: boolean }>("/api/auth/status"),
  loginUrl: () => req<{ loginUrl: string }>("/api/auth/login"),
  setToken: (t: string) =>
    req("/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ access_token: t }),
    }),
  logout:  () => req("/api/auth/logout", { method: "POST" }),
  profile: () => req<{
    user_id: string; user_name: string; email: string | null;
    avatar_url: string | null; broker: string;
  }>("/api/auth/profile"),
};

export const optionsApi = {
  expiries: (index = "NIFTY") => req<{ expiries: string[] }>(`/api/options/expiries?index=${index}`),
  chain: (expiry: string, n = 15, index = "NIFTY") =>
    req<any>(`/api/options/chain/${expiry}?strikes=${n}&index=${index}`),
  candles: (token: number, date: string, interval = "minute") =>
    req<any>(
      `/api/options/candles?token=${token}&date=${date}&interval=${interval}`,
    ),
  candleRange: (token: number, from: string, to: string, interval = "minute") =>
    req<any>(
      `/api/options/candles?token=${token}&from=${from}&to=${to}&interval=${interval}`,
    ),
  openPrices: (date: string, tokens: string) =>
    req<{ prices: Record<string, number | null> }>(
      `/api/options/open-prices?date=${date}&tokens=${tokens}`,
    ),
  historicalOpenPrices: (date: string, expiry: string) =>
    req<{
      spot: number;
      atm: number;
      rows: Array<{
        strike: number;
        isATM: boolean;
        ce: { token: number; open: number | null };
        pe: { token: number; open: number | null };
      }>;
    }>(`/api/options/historical-open-prices?date=${date}&expiry=${expiry}`),
  historicalScan: (date: string, expiry: string) =>
    req<any>(`/api/options/historical-scan?date=${date}&expiry=${expiry}`),
};

export const analysisApi = {
  scan: (expiry: string, min = 200) =>
    req<any>(`/api/analysis/scan/${expiry}?min_premium=${min}`),
  lastScan: () => req<any>("/api/analysis/last-scan"),
  rr: (entry: number) => req<any>(`/api/analysis/rr?entry=${entry}`),
};

export const smcApi = {
  status: () => req<any>("/api/smc/status"),
  alerts: (expiry: string) => req<any>(`/api/smc/alerts?expiry=${expiry}`),
  scan: (expiry: string) =>
    req<any>(`/api/smc/scan?expiry=${expiry}`, { method: "POST" }),
  clear: () => req("/api/smc/clear", { method: "DELETE" }),
  historical: (date: string, expiry: string) =>
    req<any>(`/api/smc/historical?date=${date}&expiry=${expiry}`),
  loadBacktest: (date: string) => req<any>(`/api/smc/backtest-db?date=${date}`),
};

export const autoTradeApi = {
  status: () => req<any>("/api/auto-trade/status"),
  enable: () => req<any>("/api/auto-trade/enable", { method: "POST" }),
  disable: () => req<any>("/api/auto-trade/disable", { method: "POST" }),
  clear: () => req("/api/auto-trade/positions", { method: "DELETE" }),
};

export const accountApi = {
  livePositions: () => req<{
    positions: Array<{
      tradingsymbol: string; direction: string; strike: number | null;
      quantity: number; buyPrice: number; sellPrice: number; currentPrice: number;
      pnl: number; status: string; atStatus: string | null;
      entryTime: string | null; exitTime: string | null; durationSecs: number | null;
    }>;
  }>("/api/account/positions"),
  placeOrder: (tradingsymbol: string, transaction_type: "BUY" | "SELL", quantity: number, exchange?: string) =>
    req<{ order_id: string; tradingsymbol: string; transaction_type: string; quantity: number }>(
      "/api/account/order",
      { method: "POST", body: JSON.stringify({ tradingsymbol, transaction_type, quantity, exchange }) }
    ),
  exitPosition: (tradingsymbol: string, quantity: number) =>
    req<{ order_id: string; tradingsymbol: string; quantity: number }>("/api/account/exit", {
      method: "POST",
      body: JSON.stringify({ tradingsymbol, quantity }),
    }),
  exitAll: () =>
    req<{ exited: Array<{ tradingsymbol: string; order_id?: string; error?: string; ok: boolean }> }>(
      "/api/account/exit-all", { method: "POST" }
    ),
  report: async (from: string, to: string, type: "trades" | "summary") => {
    const res = await fetch(`${API}/api/account/report?from=${from}&to=${to}&type=${type}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `pnl_${type}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  get: () => req<{
    wallet:    { available: number; used: number; net: number; deposit: number; withdrawal: number };
    charges:   { brokerage: number; stt: number; exchange: number; sebi: number; gst: number; stampDuty: number; total: number };
    pnl:       { realised: number; unrealised: number; total: number };
    positions: Array<{
      tradingsymbol: string; direction: string; strike: number | null;
      quantity: number; buyPrice: number; sellPrice: number; currentPrice: number;
      pnl: number; status: string; atStatus: string | null;
      entryTime: string | null; exitTime: string | null;
      durationSecs: number | null;
    }>;
    stats: {
      totalTrades: number; openTrades: number;
      winners: number; losers: number;
      winRate: number; avgPnl: number;
    };
    orderBook: Array<{
      order_id: string; tradingsymbol: string; transaction_type: string;
      quantity: number; price: number; trigger_price: number;
      order_type: string; status: string; time: string | null;
    }>;
  }>("/api/account"),
};

export const watchlistApi = {
  get: () => req<any[]>("/api/watchlist"),
  add: (leg: any) =>
    req<any>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ leg }),
    }),
  update: (token: number, currentPrice: number) =>
    req<any>(`/api/watchlist/${token}`, {
      method: "PATCH",
      body: JSON.stringify({ currentPrice }),
    }),
  remove: (token: number) =>
    req(`/api/watchlist/${token}`, { method: "DELETE" }),
  clear: () => req("/api/watchlist", { method: "DELETE" }),
};

export function createWS(onMessage: (msg: any) => void): WebSocket | null {
  if (typeof window === "undefined") return null;
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "wss://13.61.175.6:4000";
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => console.log("[WS] Connected to backend");
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  ws.onclose = () => console.log("[WS] Disconnected");
  ws.onerror = () =>
    console.warn("[WS] Connection failed — running in demo mode");
  return ws;
}

export const isDemoMode = DEMO;
