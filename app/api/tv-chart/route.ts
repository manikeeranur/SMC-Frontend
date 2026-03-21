import { NextRequest, NextResponse } from "next/server";

// Serves a standalone TradingView Advanced Chart page to be loaded inside an iframe.
// Using a real <script> tag in server-rendered HTML is the only way to make
// embed-widget-advanced-chart.js work — it reads document.currentScript.innerHTML
// for config, which is null when scripts are dynamically injected via JavaScript.
export function GET(req: NextRequest) {
  const sym  = req.nextUrl.searchParams.get("sym") ?? "NSE:NIFTY";
  const safe = sym.replace(/[^A-Za-z0-9:_+\-.]/g, ""); // basic sanitisation

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }
    .tradingview-widget-container { width: 100%; height: 100%; }
    .tradingview-widget-container__widget { width: 100%; height: calc(100% - 32px); }
    .tradingview-widget-copyright { font-size: 11px; text-align: center; padding: 6px 0; color: #9db2bd; }
    .tradingview-widget-copyright a { color: #9db2bd; text-decoration: none; }
  </style>
</head>
<body>
  <div class="tradingview-widget-container">
    <div class="tradingview-widget-container__widget"></div>
    <div class="tradingview-widget-copyright">
      <a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">Track all markets on TradingView</a>
    </div>
    <script type="text/javascript"
      src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
      async>
    {
      "autosize": true,
      "symbol": "${safe}",
      "interval": "1",
      "timezone": "Asia/Kolkata",
      "theme": "light",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "withdateranges": true,
      "hide_side_toolbar": false,
      "allow_symbol_change": true,
      "save_image": true,
      "hide_volume": false,
      "studies": [
        "RSI@tv-basicstudies",
        "MASimple@tv-basicstudies"
      ],
      "support_host": "https://www.tradingview.com"
    }
    </script>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
