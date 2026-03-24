const API  = process.env.NEXT_PUBLIC_API_URL  || "https://smc-backend-yheu.onrender.com";
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export class AuthError extends Error {
  constructor(msg: string) { super(msg); this.name = "AuthError"; }
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) throw new AuthError(err.error || "Session expired");
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const authApi = {
  status:      ()       => req<{ authenticated: boolean }>("/api/auth/status"),
  loginUrl:    ()       => req<{ loginUrl: string }>("/api/auth/login"),
  setToken:    (t:string) => req("/api/auth/token", { method:"POST", body:JSON.stringify({ access_token:t }) }),
  logout:      ()       => req("/api/auth/logout", { method:"POST" }),
  tokenValue:  ()       => req<{ access_token: string }>("/api/auth/token-value"),
};

export const optionsApi = {
  expiries:    ()                                          => req<{ expiries:string[] }>("/api/options/expiries"),
  chain:       (expiry:string, n=15)                      => req<any>(`/api/options/chain/${expiry}?strikes=${n}`),
candles:     (token:number, date:string, interval="minute") => req<any>(`/api/options/candles?token=${token}&date=${date}&interval=${interval}`),
  candleRange: (token:number, from:string, to:string, interval="minute") => req<any>(`/api/options/candles?token=${token}&from=${from}&to=${to}&interval=${interval}`),
  openPrices:  (date:string, tokens:string)               => req<{ prices:Record<string,number|null> }>(`/api/options/open-prices?date=${date}&tokens=${tokens}`),
  historicalOpenPrices: (date:string, expiry:string)      => req<{ spot:number; atm:number; rows:Array<{strike:number; isATM:boolean; ce:{token:number; open:number|null}; pe:{token:number; open:number|null}}> }>(`/api/options/historical-open-prices?date=${date}&expiry=${expiry}`),
  historicalScan:       (date:string, expiry:string)      => req<any>(`/api/options/historical-scan?date=${date}&expiry=${expiry}`),
};

export const analysisApi = {
  scan:     (expiry:string, min=200) => req<any>(`/api/analysis/scan/${expiry}?min_premium=${min}`),
  lastScan: ()                       => req<any>("/api/analysis/last-scan"),
  rr:       (entry:number)           => req<any>(`/api/analysis/rr?entry=${entry}`),
};

export const smcApi = {
  status:     ()                           => req<any>("/api/smc/status"),
  alerts:     (expiry:string)              => req<any>(`/api/smc/alerts?expiry=${expiry}`),
  scan:       (expiry:string)              => req<any>(`/api/smc/scan?expiry=${expiry}`, { method:"POST" }),
  clear:      ()                           => req("/api/smc/clear", { method:"DELETE" }),
  historical: (date:string, expiry:string) => req<any>(`/api/smc/historical?date=${date}&expiry=${expiry}`),
};

export const autoTradeApi = {
  status:  () => req<any>("/api/auto-trade/status"),
  enable:  () => req<any>("/api/auto-trade/enable",  { method:"POST" }),
  disable: () => req<any>("/api/auto-trade/disable", { method:"POST" }),
  clear:   () => req("/api/auto-trade/positions", { method:"DELETE" }),
};

export const watchlistApi = {
  get:    ()              => req<any[]>("/api/watchlist"),
  add:    (leg:any)       => req<any>("/api/watchlist", { method:"POST", body:JSON.stringify({ leg }) }),
  update: (token:number, currentPrice:number) =>
    req<any>(`/api/watchlist/${token}`, { method:"PATCH", body:JSON.stringify({ currentPrice }) }),
  remove: (token:number)  => req(`/api/watchlist/${token}`, { method:"DELETE" }),
  clear:  ()              => req("/api/watchlist", { method:"DELETE" }),
};

export function createWS(onMessage: (msg:any) => void): WebSocket | null {
  if (typeof window === "undefined") return null;
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "wss://smc-backend-yheu.onrender.com";
  const ws = new WebSocket(wsUrl);
  ws.onopen    = () => console.log("[WS] Connected to backend");
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
  ws.onclose   = () => console.log("[WS] Disconnected");
  ws.onerror   = () => console.warn("[WS] Connection failed — running in demo mode");
  return ws;
}

export const isDemoMode = DEMO;
