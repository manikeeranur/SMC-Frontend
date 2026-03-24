"use client";

import { useState, useEffect, useCallback } from "react";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Pattern {
  name: string;
  symbol: string;
  reliability: number;
  color: string;
  description: string;
  ratios: { leg: string; ratio: string; note: string }[];
  entry: string;
  stop: string;
  targets: string[];
  confirmation: string[];
  drawGuide: string[];
  shape: "XABCD" | "ABCD" | "NShape" | "MShape" | "WShape";
}

interface Alert {
  id: string;
  stock: string;
  pattern: string;
  tf: string;
  type: "entry" | "prz" | "target" | "stop";
  price: number;
  sl: number;
  t1: number;
  t2: number;
  triggered: boolean;
  triggeredAt: string | null;
  createdAt: string;
  color: string;
  direction: "bull" | "bear";
}

type ScanStatus = "waiting" | "triggered" | "t1" | "t2" | "sl";

interface ScanResult {
  id: string;
  stock: string;
  pattern: string;
  shape: string;
  tf: string;
  direction: "bull" | "bear";
  swings: { X?:number; A?:number; B?:number; C?:number; D?:number };
  dPoint: number;
  stop: number;
  t1: number;
  t2: number;
  rr: string;
  confidence: number;
  color: string;
  tvGuide: string;
  status: ScanStatus;
  token: number;
}

// ─── Pattern Data ─────────────────────────────────────────────────────────────
const PATTERNS: Pattern[] = [
  {
    name: "Bat", symbol: "🦇", reliability: 82, color: "#0ea5e9",
    description: "Most reliable harmonic. D at 0.886 XA retracement — deepest pullback before reversal.",
    shape: "XABCD",
    ratios: [
      { leg: "AB", ratio: "0.382–0.500", note: "Retracement of XA" },
      { leg: "BC", ratio: "0.382–0.886", note: "Retracement of AB" },
      { leg: "CD", ratio: "1.618–2.618", note: "Extension of BC" },
      { leg: "XD", ratio: "0.886",       note: "Key PRZ — 88.6% of XA" },
    ],
    entry: "Buy at D (0.886 XA). Wait for bullish candle confirmation.",
    stop:  "Below X (bearish) or above X (bullish). Max 1–1.5% risk.",
    targets: ["T1: 0.382 of CD", "T2: 0.618 of CD", "T3: A level"],
    confirmation: ["RSI divergence at D", "Volume spike", "Hammer / Engulfing", "Fib confluence"],
    drawGuide: [
      "1. Open TradingView → select your timeframe (1D recommended)",
      "2. Identify X: the deepest low before the main rally (bullish Bat)",
      "3. Mark A: the peak of the first impulse from X",
      "4. Mark B: pullback from A — must be 38.2%–50% of XA leg",
      "5. Mark C: rally from B — must be 38.2%–88.6% retracement of AB",
      "6. Mark D (PRZ): must retrace 88.6% of XA — this is the entry zone",
      "7. Use TradingView's 'XABCD Pattern' tool → connect all 5 points",
      "8. Apply Fibonacci Retracement from X to A — confirm B at 38.2–50%",
      "9. Apply Fibonacci Extension from A→B→C — confirm D at 88.6% XA",
      "10. Enter LONG at D when a bullish reversal candle forms with volume",
      "11. Stop below X, Target 1 at 38.2% of CD, Target 2 at 61.8% of CD",
    ],
  },
  {
    name: "Cypher", symbol: "⚡", reliability: 80, color: "#a855f7",
    description: "D derived from XC leg at 0.786. High accuracy in trending NSE stocks.",
    shape: "XABCD",
    ratios: [
      { leg: "AB", ratio: "0.382–0.618", note: "Retracement of XA" },
      { leg: "BC", ratio: "1.272–1.414", note: "Extension of XA" },
      { leg: "CD", ratio: "0.786",       note: "Retracement of XC — PRZ" },
      { leg: "XD", ratio: "0.786",       note: "Must equal XC retracement" },
    ],
    entry: "Enter at 0.786 XC retracement (D point).",
    stop:  "Beyond X by 0.1%. Fails if D exceeds X.",
    targets: ["T1: C level", "T2: A level", "T3: X level"],
    confirmation: ["MACD crossover at D", "BB squeeze breakout", "VSA bar at D"],
    drawGuide: [
      "1. Open TradingView → select timeframe (4H or 1D)",
      "2. Mark X: the starting low/high of the pattern",
      "3. Mark A: strong impulse move from X (high volume leg)",
      "4. Mark B: 38.2%–61.8% extension of XA beyond A",
      "5. Mark C: 78.6% retracement of the XC leg — this is D (PRZ)",
      "6. Use 'XABCD Pattern' tool → connect X→A→B→C→D",
      "7. Apply Fib Retracement from X to C — verify D at 78.6%",
      "8. D must NOT exceed X — if it does, pattern is invalid",
      "9. Enter at 78.6% XC on reversal candle (hammer/engulfing)",
      "10. Target C (T1), then A (T2). Stop just beyond X",
    ],
  },
  {
    name: "Gartley", symbol: "🎯", reliability: 78, color: "#22c55e",
    description: "Original harmonic (H.M. Gartley 1935). D at 0.786 XA. AB strictly 61.8%.",
    shape: "XABCD",
    ratios: [
      { leg: "AB", ratio: "0.618",       note: "Strict 61.8% of XA" },
      { leg: "BC", ratio: "0.382–0.886", note: "Retracement of AB" },
      { leg: "CD", ratio: "1.272–1.618", note: "Extension of BC" },
      { leg: "XD", ratio: "0.786",       note: "PRZ — 78.6% of XA" },
    ],
    entry: "Enter at 0.786 XA. AB=CD symmetry adds confluence.",
    stop:  "Below X (bullish) or above X (bearish). Risk 1%.",
    targets: ["T1: 0.382 AD", "T2: 0.618 AD", "T3: B level"],
    confirmation: ["Stochastic at D", "Pivot zone", "Prior S/R level"],
    drawGuide: [
      "1. Open TradingView → select 4H or 1D timeframe",
      "2. Mark X: the start of the trend (low for bullish, high for bearish)",
      "3. Mark A: impulse move from X — AB must be EXACTLY 61.8% of XA",
      "4. Mark B: strict 61.8% pullback from A back toward X",
      "5. Mark C: extension from B — 38.2% to 88.6% of AB",
      "6. Mark D (PRZ): 78.6% of XA from X — this is the entry",
      "7. Verify AB=CD symmetry: CD should equal AB in price",
      "8. Use 'XABCD Pattern' tool → connect X→A→B→C→D",
      "9. BUY at D (bullish) on hammer/engulfing candle confirmation",
      "10. SELL at D (bearish) on shooting star/bearish engulfing",
      "11. Stop just below/above X. T1 = 38.2% of AD, T2 = 61.8% of AD",
    ],
  },
  {
    name: "Crab", symbol: "🦀", reliability: 76, color: "#f97316",
    description: "Most extreme harmonic. D at 1.618 XA — widest stop. Best on weekly charts.",
    shape: "XABCD",
    ratios: [
      { leg: "AB", ratio: "0.382–0.618", note: "Retracement of XA" },
      { leg: "BC", ratio: "0.382–0.886", note: "Retracement of AB" },
      { leg: "CD", ratio: "2.618–3.618", note: "Extreme BC extension" },
      { leg: "XD", ratio: "1.618",       note: "161.8% of XA — extreme PRZ" },
    ],
    entry: "Enter at 1.618 XA. High reward but wide stop.",
    stop:  "1–2% beyond D. Fails if price consolidates past 1.618.",
    targets: ["T1: 0.382 CD", "T2: 0.618 CD", "T3: C level"],
    confirmation: ["Strong volume reversal", "Weekly S/R confluence", "MACD/RSI divergence"],
    drawGuide: [
      "1. Open TradingView → use Weekly or Daily chart (extreme pattern)",
      "2. Mark X: major swing low (bullish) or swing high (bearish)",
      "3. Mark A: strong impulse leg from X with high volume",
      "4. Mark B: 38.2%–61.8% pullback of XA",
      "5. Mark C: 38.2%–88.6% of AB bounce from B",
      "6. Mark D: 161.8% extension of XA beyond X — EXTREME PRZ",
      "7. D extends significantly beyond X — this is the unique Crab trait",
      "8. Use 'XABCD Pattern' tool → connect all 5 points",
      "9. Apply Fib Extension X→A extended to 161.8% — mark D",
      "10. BUY at D (bullish Crab) with very wide stop 1.5-2% below D",
      "11. T1 = 38.2% of CD retracement, T2 = 61.8% of CD",
      "12. Best used on Weekly charts where S/R confluence exists at D",
    ],
  },
  {
    name: "Butterfly", symbol: "🦋", reliability: 74, color: "#ec4899",
    description: "D extends beyond X (1.27 or 1.618 XA). Common at NSE market tops/bottoms.",
    shape: "XABCD",
    ratios: [
      { leg: "AB", ratio: "0.786",       note: "Strict 78.6% of XA" },
      { leg: "BC", ratio: "0.382–0.886", note: "Retracement of AB" },
      { leg: "CD", ratio: "1.618–2.618", note: "Extension of BC" },
      { leg: "XD", ratio: "1.27–1.618",  note: "D beyond X — key trait" },
    ],
    entry: "Enter at 1.27 or 1.618 XA extension beyond X.",
    stop:  "1.5% beyond D. Tight stop as D is at extreme.",
    targets: ["T1: B level", "T2: A level", "T3: X level"],
    confirmation: ["Gap fill reversal", "RSI divergence", "FII put/call reversal"],
    drawGuide: [
      "1. Open TradingView → Daily or 4H timeframe",
      "2. Mark X: the origin swing (low for bullish, high for bearish)",
      "3. Mark A: impulse move — AB must be EXACTLY 78.6% of XA",
      "4. Mark B: strict 78.6% retracement of XA from A",
      "5. Mark C: 38.2%–88.6% of AB from B",
      "6. Mark D: 127% or 161.8% extension of XA BEYOND X",
      "7. D goes past X — this distinguishes Butterfly from Gartley",
      "8. Use 'XABCD Pattern' tool to plot all points",
      "9. Apply Fib Extension from X→A to find 127%/161.8% extension",
      "10. BUY at D (bullish) on reversal candle — stop 1.5% beyond D",
      "11. SELL at D (bearish) — stop 1.5% above D",
      "12. T1 = B level, T2 = A level — targets are inside the pattern",
    ],
  },
  {
    name: "Half Bat", symbol: "🦇", reliability: 78, color: "#38bdf8",
    description: "Variant of Bat. D retraces exactly 50% of XA — tighter PRZ, higher precision.",
    shape: "XABCD",
    ratios: [
      { leg: "AB", ratio: "0.382–0.618", note: "Retracement of XA" },
      { leg: "BC", ratio: "0.382–0.886", note: "Retracement of AB" },
      { leg: "CD", ratio: "1.618–2.618", note: "Extension of BC" },
      { leg: "XD", ratio: "0.500",       note: "Key PRZ — exactly 50% of XA" },
    ],
    entry: "Enter at 0.500 XA. Tighter stop than Bat — high precision setup.",
    stop:  "Beyond X. Risk 1%. Tighter than full Bat.",
    targets: ["T1: 0.382 of CD", "T2: 0.618 of CD", "T3: A level"],
    confirmation: ["RSI divergence at D", "Volume spike", "Pin bar / Hammer at D"],
    drawGuide: [
      "1. Open TradingView → select your timeframe (1D or 4H)",
      "2. Mark X: starting swing low (bullish) or swing high (bearish)",
      "3. Mark A: strong impulse move from X",
      "4. Mark B: 38.2%–50% retracement of XA",
      "5. Mark C: 38.2%–88.6% retracement of AB from B",
      "6. Mark D (PRZ): EXACTLY 50% retracement of XA — tighter than Bat",
      "7. Use Fibonacci Retracement X→A — mark the 50% level as D",
      "8. Use 'XABCD Pattern' tool → connect X→A→B→C→D",
      "9. BUY at D (bullish) / SELL at D (bearish) on reversal candle",
      "10. PRZ is tighter than standard Bat — precision entry required",
      "11. Stop just below X (bullish) or above X (bearish)",
      "12. T1 = 38.2% of CD, T2 = 61.8% of CD",
    ],
  },
  {
    name: "ABCD", symbol: "📐", reliability: 72, color: "#f59e0b",
    description: "Foundation pattern. Symmetrical legs. AB = CD in price and time.",
    shape: "ABCD",
    ratios: [
      { leg: "AB",    ratio: "—",        note: "Initial impulse leg" },
      { leg: "BC",    ratio: "0.618–0.786", note: "Retracement of AB" },
      { leg: "CD",    ratio: "1.272–1.618", note: "Extension — equals AB" },
      { leg: "AB=CD", ratio: "Equal",    note: "Price & time symmetry" },
    ],
    entry: "Enter at D when CD ≈ AB length. Simplest execution.",
    stop:  "Below/above C. Small risk, clear invalidation.",
    targets: ["T1: 0.382 AD", "T2: 0.618 AD", "T3: A level"],
    confirmation: ["Equal AB=CD time bars", "Candle at D", "Volume drop BC, spike D"],
    drawGuide: [
      "1. Open TradingView → any timeframe (most versatile pattern)",
      "2. Mark A: starting swing point (low for bullish, high for bearish)",
      "3. Mark B: first impulse — strong directional move from A",
      "4. Mark C: 61.8%–78.6% retracement of AB pullback",
      "5. Mark D: extension from C — CD should equal AB in price distance",
      "6. Use 'ABCD Pattern' tool in TradingView to auto-validate ratios",
      "7. Check: BC/AB = 0.618–0.786, CD = 1.272–1.618 extension of BC",
      "8. Most important: AB and CD should be equal in bar count (time)",
      "9. BUY at D (bullish ABCD) — when C is a higher low",
      "10. SELL at D (bearish ABCD) — when C is a lower high",
      "11. Stop below/above C. T1 = 38.2% of AD, T2 = 61.8% of AD",
    ],
  },
  {
    name: "N Pattern", symbol: "〰", reliability: 70, color: "#06b6d4",
    description: "Trend continuation. N-shape — pullback then new high (bull) or new low (bear).",
    shape: "NShape",
    ratios: [
      { leg: "A→B",    ratio: "Impulse",     note: "Strong trend leg" },
      { leg: "B→C",    ratio: "0.382–0.618", note: "Shallow pullback" },
      { leg: "C→D",    ratio: "1.000–1.618", note: "Extension beyond B" },
      { leg: "BC ret.", ratio: "< 50%",      note: "Shallow = strong trend" },
    ],
    entry: "Enter at C (pullback end). Target D = BC ext beyond B.",
    stop:  "Below A (bull) or above A (bear). Trend must hold.",
    targets: ["T1: B breakout level", "T2: 1.272 BC ext", "T3: 1.618 BC ext"],
    confirmation: ["Above 20 EMA at C", "Lower volume pullback", "Breakout candle at B"],
    drawGuide: [
      "1. Open TradingView → 1H, 4H or 1D timeframe",
      "2. Identify a strong trending stock (above 20 EMA for bullish)",
      "3. Mark A: the start of the trend (swing low for bullish)",
      "4. Mark B: first major swing high in the trend",
      "5. Mark C: pullback from B — must be LESS than 50% of AB",
      "6. C is the ENTRY POINT for bullish N Pattern (BUY at C)",
      "7. D = projected new high beyond B (1.0–1.618 BC extension)",
      "8. Draw trendline A→B and extend — C should touch this line",
      "9. Use Fibonacci Extension A→B→C to project D",
      "10. BUY at C on bullish confirmation (hold above 20 EMA)",
      "11. SELL at C on bearish N Pattern (below 20 EMA)",
      "12. Stop below A (bullish) — if A breaks, N Pattern is invalid",
    ],
  },
  {
    name: "M Pattern", symbol: "Μ", reliability: 68, color: "#e11d48",
    description: "Double-top reversal. Two peaks at similar price — bearish. Common at NSE resistance.",
    shape: "MShape",
    ratios: [
      { leg: "Peak 1",   ratio: "—",        note: "First top — high volume" },
      { leg: "Neckline", ratio: "—",        note: "Support between peaks" },
      { leg: "Peak 2",   ratio: "≈ Peak 1", note: "Lower volume — weakness" },
      { leg: "Target",   ratio: "= Height", note: "Neckline − pattern height" },
    ],
    entry: "Short on neckline break. Retest = ideal entry.",
    stop:  "Above Peak 2. Risk 1% of capital.",
    targets: ["T1: 50% of height below neck", "T2: 100% of height", "T3: Next major support"],
    confirmation: ["Lower volume on P2", "RSI divergence at P2", "MACD bearish cross"],
    drawGuide: [
      "1. Open TradingView → Daily or 4H chart",
      "2. Identify two peaks at approximately the same price level",
      "3. Mark Peak 1: first top (should have high volume)",
      "4. Mark Neckline: the low between the two peaks (support level)",
      "5. Mark Peak 2: second top at ≈ Peak 1 price (LOWER volume = bearish)",
      "6. Draw a horizontal line at the Neckline level",
      "7. Confirm: RSI bearish divergence at Peak 2 (lower RSI at same price)",
      "8. SELL SHORT when price closes BELOW the Neckline",
      "9. Ideal entry: retest of the broken neckline from below",
      "10. Stop Loss: above Peak 2 (pattern fails if P2 is broken)",
      "11. Target = Neckline − (Peak 1 − Neckline) = pattern height below neck",
      "12. Use 'Double Top' pattern tool in TradingView for auto-measurement",
    ],
  },
  {
    name: "W Pattern", symbol: "W", reliability: 68, color: "#10b981",
    description: "Double-bottom reversal. Two troughs at similar price — bullish. NSE support zones.",
    shape: "WShape",
    ratios: [
      { leg: "Bottom 1", ratio: "—",        note: "First trough — high volume" },
      { leg: "Neckline", ratio: "—",        note: "Resistance between bottoms" },
      { leg: "Bottom 2", ratio: "≈ B1",     note: "Lower volume — exhaustion" },
      { leg: "Target",   ratio: "= Height", note: "Neckline + pattern height" },
    ],
    entry: "Buy on neckline breakout. Pullback = low-risk entry.",
    stop:  "Below Bottom 2. Risk 1% of capital.",
    targets: ["T1: 50% of height above neck", "T2: 100% of height", "T3: Next major resistance"],
    confirmation: ["Lower volume B2", "RSI bullish divergence", "Bullish engulfing at B2"],
    drawGuide: [
      "1. Open TradingView → Daily or 4H chart",
      "2. Identify two troughs at approximately the same price level",
      "3. Mark Bottom 1: first trough (high volume — panic selling)",
      "4. Mark Neckline: the high between the two bottoms (resistance)",
      "5. Mark Bottom 2: second trough at ≈ Bottom 1 (LOWER volume = exhaustion)",
      "6. Draw a horizontal line at the Neckline level",
      "7. Confirm: RSI bullish divergence at Bottom 2 (higher RSI at same price)",
      "8. BUY when price closes ABOVE the Neckline (breakout confirmation)",
      "9. Ideal entry: pullback to the broken neckline from above",
      "10. Stop Loss: below Bottom 2 (pattern fails if B2 is broken)",
      "11. Target = Neckline + (Neckline − Bottom 1) = pattern height above neck",
      "12. Use 'Double Bottom' pattern tool in TradingView for auto-measurement",
    ],
  },
];

// ─── NSE Stocks with TradingView tokens ───────────────────────────────────────
const NSE_STOCKS = [
  { symbol:"RELIANCE",   token:738561,  exchange:"NSE" },
  { symbol:"TCS",        token:2953217, exchange:"NSE" },
  { symbol:"HDFCBANK",   token:341249,  exchange:"NSE" },
  { symbol:"INFY",       token:408065,  exchange:"NSE" },
  { symbol:"ICICIBANK",  token:1270529, exchange:"NSE" },
  { symbol:"BAJFINANCE", token:225537,  exchange:"NSE" },
  { symbol:"SBIN",       token:779521,  exchange:"NSE" },
  { symbol:"TATAMOTORS", token:884737,  exchange:"NSE" },
  { symbol:"WIPRO",      token:969473,  exchange:"NSE" },
  { symbol:"NIFTY 50",   token:256265,  exchange:"NSE" },
  { symbol:"BANKNIFTY",  token:260105,  exchange:"NSE" },
  { symbol:"TATASTEEL",  token:895745,  exchange:"NSE" },
  { symbol:"AXISBANK",   token:1510401, exchange:"NSE" },
  { symbol:"KOTAKBANK",  token:492033,  exchange:"NSE" },
  { symbol:"LT",         token:2939649, exchange:"NSE" },
];

const TIMEFRAMES = ["5m","15m","30m","1H","4H","1D","1W"];


const MOCK_ALERTS: Alert[] = [
  { id:"a1", stock:"RELIANCE",  pattern:"Bat",       tf:"1D", type:"entry",  price:2820, sl:2775, t1:2900, t2:2960, direction:"bull", triggered:false, triggeredAt:null,            createdAt:"23 Mar, 09:15 AM", color:"#0ea5e9" },
  { id:"a2", stock:"HDFCBANK",  pattern:"Gartley",   tf:"4H", type:"entry",  price:1682, sl:1650, t1:1720, t2:1755, direction:"bull", triggered:true,  triggeredAt:"22 Mar, 02:18 PM", createdAt:"22 Mar, 09:15 AM", color:"#22c55e" },
  { id:"a3", stock:"INFY",      pattern:"Cypher",    tf:"1D", type:"entry",  price:1540, sl:1568, t1:1498, t2:1465, direction:"bear", triggered:false, triggeredAt:null,            createdAt:"23 Mar, 09:15 AM", color:"#a855f7" },
  { id:"a4", stock:"SBIN",      pattern:"W Pattern", tf:"1D", type:"target", price:790,  sl:735,  t1:790,  t2:812,  direction:"bull", triggered:true,  triggeredAt:"22 Mar, 11:32 AM", createdAt:"21 Mar, 09:15 AM", color:"#10b981" },
  { id:"a5", stock:"BANKNIFTY", pattern:"M Pattern", tf:"4H", type:"entry",  price:51200,sl:51650,t1:50350,t2:49800,direction:"bear", triggered:false, triggeredAt:null,            createdAt:"23 Mar, 09:15 AM", color:"#e11d48" },
];

// ─── SVG Diagrams ──────────────────────────────────────────────────────────────
function XABCDDiag({ color, bull=true }: { color:string; bull?:boolean }) {
  const p = bull
    ? [[12,88],[42,20],[64,62],[82,28],[112,78]]
    : [[12,20],[42,88],[64,46],[82,80],[112,28]];
  const lbl = ["X","A","B","C","D"];
  const d = p.map((pt,i)=>`${i===0?"M":"L"}${pt[0]},${pt[1]}`).join(" ");
  return (
    <svg viewBox="0 0 128 108" className="w-full h-28">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" opacity={0.75}/>
      {p.map((pt,i)=>(
        <g key={i}>
          <circle cx={pt[0]} cy={pt[1]} r={4} fill={color} opacity={0.9}/>
          <text x={pt[0]} y={pt[1]+(bull&&i%2===0?-9:13)} textAnchor="middle"
            style={{fontSize:10,fill:color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{lbl[i]}</text>
        </g>
      ))}
      <rect x={p[4][0]-9} y={bull?p[4][1]-16:p[4][1]+2} width={18} height={13} rx={2}
        fill={color} opacity={0.12} stroke={color} strokeWidth={1} strokeDasharray="2,2"/>
      <text x={p[4][0]+15} y={bull?p[4][1]-5:p[4][1]+11}
        style={{fontSize:7,fill:color,fontFamily:"'Space Mono',monospace"}}>PRZ</text>
    </svg>
  );
}

function ABCDDiag({ color }: { color:string }) {
  const p = [[10,80],[55,20],[72,60],[115,20]];
  const lbl = ["A","B","C","D"];
  const d = p.map((pt,i)=>`${i===0?"M":"L"}${pt[0]},${pt[1]}`).join(" ");
  return (
    <svg viewBox="0 0 128 108" className="w-full h-28">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" opacity={0.75}/>
      <line x1={p[0][0]} y1={p[0][1]+9} x2={p[1][0]} y2={p[0][1]+9} stroke={color} strokeWidth={1} strokeDasharray="2,2" opacity={0.4}/>
      <line x1={p[2][0]} y1={p[2][1]+9} x2={p[3][0]} y2={p[2][1]+9} stroke={color} strokeWidth={1} strokeDasharray="2,2" opacity={0.4}/>
      {p.map((pt,i)=>(
        <g key={i}>
          <circle cx={pt[0]} cy={pt[1]} r={4} fill={color} opacity={0.9}/>
          <text x={pt[0]} y={pt[1]-9} textAnchor="middle"
            style={{fontSize:10,fill:color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{lbl[i]}</text>
        </g>
      ))}
      <text x={64} y={100} textAnchor="middle"
        style={{fontSize:8,fill:color,fontFamily:"'Space Mono',monospace",opacity:0.7}}>AB = CD</text>
    </svg>
  );
}

function NDiag({ color }: { color:string }) {
  const p = [[10,82],[55,24],[76,55],[118,14]];
  const lbl = ["A","B","C","D"];
  const d = p.map((pt,i)=>`${i===0?"M":"L"}${pt[0]},${pt[1]}`).join(" ");
  return (
    <svg viewBox="0 0 128 108" className="w-full h-28">
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" opacity={0.8}/>
      {p.map((pt,i)=>(
        <g key={i}>
          <circle cx={pt[0]} cy={pt[1]} r={4} fill={color} opacity={0.9}/>
          <text x={pt[0]} y={pt[1]+(i===2?13:-9)} textAnchor="middle"
            style={{fontSize:10,fill:color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{lbl[i]}</text>
        </g>
      ))}
      <text x={64} y={100} textAnchor="middle"
        style={{fontSize:8,fill:color,fontFamily:"'Space Mono',monospace",opacity:0.7}}>TREND CONTINUATION</text>
    </svg>
  );
}

function MDiag({ color }: { color:string }) {
  const p = [[10,68],[38,20],[63,54],[90,22],[118,68]];
  const lbl = ["","P1","","P2",""];
  const d = p.map((pt,i)=>`${i===0?"M":"L"}${pt[0]},${pt[1]}`).join(" ");
  return (
    <svg viewBox="0 0 128 108" className="w-full h-28">
      <line x1={5} y1={70} x2={123} y2={70} stroke={color} strokeWidth={1} strokeDasharray="3,2" opacity={0.35}/>
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" opacity={0.8}/>
      {p.map((pt,i)=>(
        <g key={i}>
          <circle cx={pt[0]} cy={pt[1]} r={3.5} fill={color} opacity={0.9}/>
          {lbl[i]&&<text x={pt[0]} y={pt[1]-9} textAnchor="middle"
            style={{fontSize:9,fill:color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{lbl[i]}</text>}
        </g>
      ))}
      <text x={6} y={65} style={{fontSize:7,fill:color,fontFamily:"'Space Mono',monospace",opacity:0.55}}>NECK</text>
      <text x={64} y={100} textAnchor="middle"
        style={{fontSize:8,fill:color,fontFamily:"'Space Mono',monospace",opacity:0.7}}>DOUBLE TOP · BEARISH</text>
    </svg>
  );
}

function WDiag({ color }: { color:string }) {
  const p = [[10,25],[38,76],[63,42],[90,74],[118,25]];
  const lbl2 = ["","B1","","B2",""];
  const d = p.map((pt,i)=>`${i===0?"M":"L"}${pt[0]},${pt[1]}`).join(" ");
  return (
    <svg viewBox="0 0 128 108" className="w-full h-28">
      <line x1={5} y1={28} x2={123} y2={28} stroke={color} strokeWidth={1} strokeDasharray="3,2" opacity={0.35}/>
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" opacity={0.8}/>
      {p.map((pt,i)=>(
        <g key={i}>
          <circle cx={pt[0]} cy={pt[1]} r={3.5} fill={color} opacity={0.9}/>
          {lbl2[i]&&<text x={pt[0]} y={pt[1]+17} textAnchor="middle"
            style={{fontSize:9,fill:color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{lbl2[i]}</text>}
        </g>
      ))}
      <text x={6} y={24} style={{fontSize:7,fill:color,fontFamily:"'Space Mono',monospace",opacity:0.55}}>NECK</text>
      <text x={64} y={100} textAnchor="middle"
        style={{fontSize:8,fill:color,fontFamily:"'Space Mono',monospace",opacity:0.7}}>DOUBLE BOTTOM · BULLISH</text>
    </svg>
  );
}

function Diagram({ p }: { p:Pattern }) {
  if (p.shape==="ABCD")   return <ABCDDiag color={p.color}/>;
  if (p.shape==="NShape") return <NDiag color={p.color}/>;
  if (p.shape==="MShape") return <MDiag color={p.color}/>;
  if (p.shape==="WShape") return <WDiag color={p.color}/>;
  return <XABCDDiag color={p.color} bull={p.name!=="Butterfly"}/>;
}

function Bar({ pct, color }: { pct:number; color:string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{background:"var(--c-border)"}}>
        <div className="h-full rounded-full" style={{width:`${pct}%`,background:color}}/>
      </div>
      <span className="text-[10px] font-bold w-8" style={{...MONO,color}}>{pct}%</span>
    </div>
  );
}

// ─── Open chart helpers ────────────────────────────────────────────────────────
function openTradingView(symbol: string, tf: string) {
  const tvTf: Record<string,string> = { "5m":"5","15m":"15","30m":"30","1H":"60","4H":"240","1D":"D","1W":"W" };
  const s = symbol.replace(" ","");
  window.open(`https://www.tradingview.com/chart/?symbol=NSE%3A${s}&interval=${tvTf[tf]||"D"}`, "_blank");
}

function openSensibull(symbol: string) {
  const s = symbol.replace(" ","").replace("NIFTY50","NIFTY").replace("BANKNIFTY","BANKNIFTY");
  window.open(`https://web.sensibull.com/optionchain?symbol=${s}`, "_blank");
}

// ─── Scan Result Card ─────────────────────────────────────────────────────────
const STATUS_CFG: Record<ScanStatus,{label:string;color:string;bg:string}> = {
  waiting:   { label:"⏳ WAITING CONFIRMATION", color:"#f59e0b", bg:"rgba(245,158,11,0.08)"  },
  triggered: { label:"✓ ENTRY TRIGGERED",       color:"#22c55e", bg:"rgba(34,197,94,0.08)"   },
  t1:        { label:"🎯 TARGET 1 HIT",          color:"#0ea5e9", bg:"rgba(14,165,233,0.08)"  },
  t2:        { label:"🏆 TARGET 2 HIT",          color:"#a855f7", bg:"rgba(168,85,247,0.08)"  },
  sl:        { label:"✕ STOP LOSS HIT",          color:"#e11d48", bg:"rgba(225,29,72,0.08)"   },
};

function ScanCard({ r, onStatusChange }: { r:ScanResult; onStatusChange:(id:string,s:ScanStatus)=>void }) {
  const [showGuide, setShowGuide] = useState(false);
  const sc = STATUS_CFG[r.status];
  const fmt = (n?:number) => n != null ? n.toLocaleString("en-IN",{maximumFractionDigits:2}) : "—";
  const isXABCD = r.shape === "XABCD";
  const swingKeys = isXABCD ? ["X","A","B","C","D"] : ["A","B","C","D"];

  return (
    <div className="rounded-lg border overflow-hidden" style={{background:"var(--c-card)",borderColor:r.color,borderWidth:1}}>
      {/* Top accent */}
      <div className="h-0.5" style={{background:r.color}}/>

      {/* Header row */}
      <div className="px-3 pt-2.5 pb-2 flex items-start justify-between gap-2 border-b" style={{borderColor:"var(--c-bord2)"}}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold" style={{...BEBAS,color:"var(--c-text)",letterSpacing:"1px",fontSize:17}}>{r.stock}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold"
              style={{...MONO,background:`${r.color}18`,color:r.color,border:`1px solid ${r.color}40`}}>{r.pattern}</span>
            <span className="text-[8px] px-1 py-0.5 rounded"
              style={{...MONO,background:"var(--c-muted)",color:"var(--c-text3)",border:"1px solid var(--c-bord2)"}}>{r.shape}</span>
            <span className="text-[8px] px-1 py-0.5 rounded font-bold"
              style={{...MONO,background:"var(--c-muted)",color:"var(--c-text4)",border:"1px solid var(--c-bord2)"}}>{r.tf}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold"
              style={{...MONO,background:r.direction==="bull"?"#22c55e22":"#e11d4822",color:r.direction==="bull"?"#22c55e":"#e11d48",border:`1px solid ${r.direction==="bull"?"#22c55e":"#e11d48"}40`}}>
              {r.direction==="bull"?"▲ BUY":"▼ SELL"}
            </span>
          </div>
          {/* Status badge */}
          <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm"
            style={{background:sc.bg,border:`1px solid ${sc.color}30`}}>
            <span className="text-[8px] font-bold" style={{...MONO,color:sc.color}}>{sc.label}</span>
          </div>
        </div>
        {/* Confidence */}
        <div className="shrink-0 text-center">
          <div className="text-[18px] font-bold" style={{...MONO,color:r.color,lineHeight:1}}>{r.confidence}%</div>
          <div className="text-[7px]" style={{...MONO,color:"var(--c-text4)"}}>CONFIDENCE</div>
        </div>
      </div>

      {/* Swing prices — XABCD or ABCD */}
      <div className="px-3 py-2 border-b" style={{borderColor:"var(--c-bord2)"}}>
        <div className="text-[8px] tracking-widest mb-1.5" style={{...MONO,color:"var(--c-text4)"}}>{r.shape} SWING PRICES</div>
        <div className={`grid gap-1`} style={{gridTemplateColumns:`repeat(${swingKeys.length},1fr)`}}>
          {swingKeys.map(k=>(
            <div key={k} className="rounded px-1.5 py-1 text-center"
              style={{background: k==="D" ? `${r.color}18` : "var(--c-sub)", border: k==="D" ? `1px solid ${r.color}40` : "1px solid var(--c-bord2)"}}>
              <div className="text-[8px] font-bold" style={{...MONO,color: k==="D" ? r.color : "var(--c-text3)"}}>{k}</div>
              <div className="text-[9px] font-bold" style={{...MONO,color:"var(--c-text)"}}>{fmt((r.swings as any)[k])}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Entry / SL / T1 / T2 */}
      <div className="px-3 py-2 border-b" style={{borderColor:"var(--c-bord2)"}}>
        <div className="grid grid-cols-4 gap-1">
          <div className="rounded px-1.5 py-1 text-center" style={{background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)"}}>
            <div className="text-[7px] tracking-widest" style={{...MONO,color:"#22c55e"}}>ENTRY (D)</div>
            <div className="text-[10px] font-bold" style={{...MONO,color:"#22c55e"}}>₹{fmt(r.dPoint)}</div>
          </div>
          <div className="rounded px-1.5 py-1 text-center" style={{background:"rgba(225,29,72,0.08)",border:"1px solid rgba(225,29,72,0.25)"}}>
            <div className="text-[7px] tracking-widest" style={{...MONO,color:"#e11d48"}}>STOP LOSS</div>
            <div className="text-[10px] font-bold" style={{...MONO,color:"#e11d48"}}>₹{fmt(r.stop)}</div>
          </div>
          <div className="rounded px-1.5 py-1 text-center" style={{background:"rgba(234,179,8,0.08)",border:"1px solid rgba(234,179,8,0.25)"}}>
            <div className="text-[7px] tracking-widest" style={{...MONO,color:"#eab308"}}>TARGET 1</div>
            <div className="text-[10px] font-bold" style={{...MONO,color:"#eab308"}}>₹{fmt(r.t1)}</div>
          </div>
          <div className="rounded px-1.5 py-1 text-center" style={{background:"rgba(74,222,128,0.08)",border:"1px solid rgba(74,222,128,0.25)"}}>
            <div className="text-[7px] tracking-widest" style={{...MONO,color:"#4ade80"}}>TARGET 2</div>
            <div className="text-[10px] font-bold" style={{...MONO,color:"#4ade80"}}>₹{fmt(r.t2)}</div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[8px]" style={{...MONO,color:"var(--c-text4)"}}>R:R Ratio</span>
          <span className="text-[9px] font-bold" style={{...MONO,color:"#0ea5e9"}}>{r.rr}</span>
        </div>
      </div>

      {/* TradingView guide toggle */}
      {r.tvGuide && (
        <div className="px-3 py-2 border-b" style={{borderColor:"var(--c-bord2)"}}>
          <button onClick={()=>setShowGuide(g=>!g)}
            className="w-full flex items-center justify-between text-[9px] py-0.5 transition-opacity hover:opacity-70"
            style={{...MONO,color:"#0284c7",background:"none",border:"none",cursor:"pointer"}}>
            <span>📊 How to draw on TradingView ({r.tf} chart)</span>
            <span>{showGuide?"▲":"▼"}</span>
          </button>
          {showGuide && (
            <div className="mt-2 rounded p-2.5 space-y-1" style={{background:"var(--c-sub)",border:"1px solid var(--c-bord2)"}}>
              {r.tvGuide.split("\n").map((line,i)=>(
                <div key={i} className="text-[9px] leading-relaxed" style={{...MONO,color:"var(--c-text2)"}}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-3 py-2">
        <div className="text-[8px] tracking-widest mb-1.5" style={{...MONO,color:"var(--c-text4)"}}>UPDATE STATUS</div>
        <div className="grid grid-cols-5 gap-1 mb-2">
          {(Object.keys(STATUS_CFG) as ScanStatus[]).map(s=>(
            <button key={s} onClick={()=>onStatusChange(r.id,s)}
              className="text-[7px] py-1 rounded-sm font-bold transition-all"
              style={{...MONO,
                background: r.status===s ? STATUS_CFG[s].color : "var(--c-muted)",
                color: r.status===s ? "#fff" : "var(--c-text3)",
                border: `1px solid ${r.status===s ? STATUS_CFG[s].color : "var(--c-bord2)"}`,
              }}>
              {s==="waiting"?"WAIT":s==="triggered"?"ENTRY":s==="t1"?"T1 HIT":s==="t2"?"T2 HIT":"SL HIT"}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={()=>openTradingView(r.stock,r.tf)}
            className="flex-1 text-[8px] py-1.5 rounded-sm font-bold transition-opacity hover:opacity-80"
            style={{...MONO,background:"rgba(2,132,199,0.12)",color:"#0284c7",border:"1px solid #0284c740"}}>
            📈 TradingView ↗
          </button>
          <button onClick={()=>openSensibull(r.stock)}
            className="flex-1 text-[8px] py-1.5 rounded-sm font-bold transition-opacity hover:opacity-80"
            style={{...MONO,background:"rgba(168,85,247,0.12)",color:"#a855f7",border:"1px solid #a855f740"}}>
            🔗 Sensibull ↗
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SCAN TAB ─────────────────────────────────────────────────────────────────
function ScanTab({ dark }: { dark:boolean }) {
  const [results, setResults]   = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [tf, setTf]             = useState("1D");
  const [pattern, setPattern]   = useState("All");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth()-4); return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate]     = useState(() => new Date().toISOString().split("T")[0]);
  const [maxPrice, setMaxPrice] = useState("10000");
  const [statusTab, setStatusTab] = useState<ScanStatus|"all">("all");
  const [lastScan, setLastScan] = useState<string|null>(null);
  const [error, setError]       = useState<string|null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const params = new URLSearchParams({ interval:tf, from:fromDate, to:toDate, pattern, maxPrice });
      const res = await fetch(`http://localhost:4000/api/harmonics/scan?${params}`);
      if (res.status === 401) throw new Error("Not authenticated — please login to Kite first");
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Scan failed"); }
      const data = await res.json();
      const tagged: ScanResult[] = (data.results || []).map((r: any, i: number) => ({
        ...r, id: `${r.stock}_${r.pattern}_${r.direction}_${i}`, status:"waiting" as ScanStatus,
      }));
      setResults(tagged);
      setLastScan(new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  }, [pattern, tf, fromDate, toDate, maxPrice]);

  const updateStatus = useCallback((id: string, s: ScanStatus) => {
    setResults(prev => prev.map(r => r.id===id ? {...r, status:s} : r));
  }, []);

  const STATUS_TABS: {id:ScanStatus|"all";label:string}[] = [
    {id:"all",       label:"All"},
    {id:"waiting",   label:"⏳ Waiting"},
    {id:"triggered", label:"✓ Triggered"},
    {id:"t1",        label:"🎯 T1 Hit"},
    {id:"t2",        label:"🏆 T2 Hit"},
    {id:"sl",        label:"✕ SL Hit"},
  ];

  const filtered = statusTab==="all" ? results : results.filter(r=>r.status===statusTab);
  const counts   = Object.fromEntries(
    (["all","waiting","triggered","t1","t2","sl"] as (ScanStatus|"all")[]).map(s => [
      s, s==="all" ? results.length : results.filter(r=>r.status===s).length
    ])
  );

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="rounded-lg border p-3" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>PATTERN</div>
            <select value={pattern} onChange={e=>setPattern(e.target.value)}
              className="text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              <option>All</option>
              {PATTERNS.map(p=><option key={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>TIMEFRAME</div>
            <select value={tf} onChange={e=>setTf(e.target.value)}
              className="text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              {TIMEFRAMES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>MAX PRICE (₹)</div>
            <select value={maxPrice} onChange={e=>setMaxPrice(e.target.value)}
              className="text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              <option value="5000">≤ ₹5,000</option>
              <option value="10000">≤ ₹10,000</option>
              <option value="50000">All prices</option>
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>FROM DATE</div>
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}
              className="text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}/>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>TO DATE</div>
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}
              className="text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}/>
          </div>
          <button onClick={scan} disabled={scanning}
            className="px-4 py-1.5 rounded-sm text-[10px] font-bold transition-all"
            style={{...MONO,background:scanning?"var(--c-muted)":"#0284c7",color:"#fff",border:"none",
              cursor:scanning?"not-allowed":"pointer",opacity:scanning?0.7:1}}>
            {scanning?"⏳ SCANNING…":"🔍 SCAN NSE"}
          </button>
          {lastScan&&<span className="text-[9px]" style={{...MONO,color:"var(--c-text4)"}}>Scanned: {lastScan}</span>}
        </div>
      </div>

      {/* Error */}
      {error&&(
        <div className="rounded-lg border p-3 text-[10px]" style={{background:"rgba(225,29,72,0.06)",borderColor:"rgba(225,29,72,0.25)",...MONO,color:"#e11d48"}}>
          ✕ {error}
        </div>
      )}

      {/* Empty state */}
      {!scanning && results.length===0 && !error && (
        <div className="rounded-lg border p-10 text-center" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
          <div className="text-3xl mb-2">📐</div>
          <div className="text-[11px] mb-1" style={{...MONO,color:"var(--c-text2)"}}>No scan results yet</div>
          <div className="text-[9px]" style={{...MONO,color:"var(--c-text4)"}}>
            Select date range, timeframe, pattern — click SCAN NSE
          </div>
          <div className="text-[9px] mt-1" style={{...MONO,color:"var(--c-text4)"}}>
            Stocks above ₹{parseInt(maxPrice).toLocaleString("en-IN")} are automatically excluded
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      {results.length>0 && (
        <div className="flex overflow-x-auto border rounded-lg" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
          {STATUS_TABS.map(t=>(
            <button key={t.id} onClick={()=>setStatusTab(t.id)}
              className="px-3 py-2 text-[9px] whitespace-nowrap border-b-2 transition-colors flex items-center gap-1"
              style={{...MONO,
                borderColor:statusTab===t.id?(t.id==="all"?"#0284c7":STATUS_CFG[t.id as ScanStatus]?.color||"#0284c7"):"transparent",
                color:statusTab===t.id?(t.id==="all"?"#0284c7":STATUS_CFG[t.id as ScanStatus]?.color||"#0284c7"):"var(--c-text3)",
                background:"transparent",
              }}>
              {t.label}
              <span className="text-[8px] px-1 py-0.5 rounded" style={{
                background:"var(--c-muted)",color:"var(--c-text4)",border:"1px solid var(--c-bord2)"
              }}>{counts[t.id]||0}</span>
            </button>
          ))}
        </div>
      )}

      {/* Cards grid */}
      {filtered.length>0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(r=><ScanCard key={r.id} r={r} onStatusChange={updateStatus}/>)}
        </div>
      )}

      {results.length>0 && filtered.length===0 && (
        <div className="rounded-lg border p-8 text-center" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
          <div className="text-[10px]" style={{...MONO,color:"var(--c-text4)"}}>No setups in "{statusTab}" status</div>
        </div>
      )}

      {results.length>0 && (
        <div className="rounded-lg border p-3 text-[9px]" style={{background:"rgba(234,88,12,0.06)",borderColor:"rgba(234,88,12,0.25)",color:"#ea580c",...MONO}}>
          ⚠ Real Kite historical data · Fibonacci swing detection · Always confirm visually on TradingView before trading
        </div>
      )}
    </div>
  );
}

// ─── ALERTS TAB ───────────────────────────────────────────────────────────────
function AlertsTab({ dark }: { dark:boolean }) {
  const [alerts, setAlerts]       = useState<Alert[]>(MOCK_ALERTS);
  const [newStock,   setNewStock]   = useState("RELIANCE");
  const [newPattern, setNewPattern] = useState("Bat");
  const [newTf,      setNewTf]      = useState("1D");
  const [newType,    setNewType]    = useState<Alert["type"]>("entry");
  const [newPrice,   setNewPrice]   = useState("");
  const [newSl,      setNewSl]      = useState("");
  const [newT1,      setNewT1]      = useState("");
  const [newT2,      setNewT2]      = useState("");
  const [newDir,     setNewDir]     = useState<"bull"|"bear">("bull");
  const [added,      setAdded]      = useState(false);
  const [filter,     setFilter]     = useState<"all"|"pending"|"triggered">("all");

  const addAlert = () => {
    if (!newPrice||!newSl||!newT1) return;
    const p = PATTERNS.find(x=>x.name===newPattern)!;
    const now = new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    const a: Alert = {
      id: Date.now().toString(),
      stock: newStock, pattern: newPattern, tf: newTf,
      type: newType, price: parseFloat(newPrice),
      sl: parseFloat(newSl),
      t1: parseFloat(newT1),
      t2: parseFloat(newT2||newT1),
      direction: newDir,
      triggered: false, triggeredAt: null,
      createdAt: now,
      color: p?.color||"#0ea5e9",
    };
    setAlerts(prev=>[a,...prev]);
    setNewPrice(""); setNewSl(""); setNewT1(""); setNewT2("");
    setAdded(true);
    setTimeout(()=>setAdded(false),2000);
  };

  const removeAlert    = (id:string) => setAlerts(prev=>prev.filter(a=>a.id!==id));
  const toggleTrigger  = (id:string) => setAlerts(prev=>prev.map(a=>{
    if (a.id!==id) return a;
    const now = new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    return a.triggered ? {...a, triggered:false, triggeredAt:null} : {...a, triggered:true, triggeredAt:now};
  }));

  const typeColors: Record<string,string> = { entry:"#22c55e", prz:"#0ea5e9", target:"#eab308", stop:"#e11d48" };
  const typeLabel:  Record<string,string> = { entry:"ENTRY TRIGGERED", prz:"PRICE IN PRZ", target:"TARGET HIT", stop:"STOP HIT" };

  const filtered = alerts.filter(a =>
    filter==="all" ? true : filter==="pending" ? !a.triggered : a.triggered
  );

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Add alert form */}
      <div className="rounded-lg border p-4" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="text-[9px] tracking-widest mb-3" style={{...MONO,color:"var(--c-text4)"}}>CREATE ALERT</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>STOCK</div>
            <select value={newStock} onChange={e=>setNewStock(e.target.value)}
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              {NSE_STOCKS.map(s=><option key={s.symbol}>{s.symbol}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>PATTERN</div>
            <select value={newPattern} onChange={e=>setNewPattern(e.target.value)}
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              {PATTERNS.map(p=><option key={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>TIMEFRAME</div>
            <select value={newTf} onChange={e=>setNewTf(e.target.value)}
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              {TIMEFRAMES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>DIRECTION</div>
            <select value={newDir} onChange={e=>setNewDir(e.target.value as "bull"|"bear")}
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              <option value="bull">▲ Bullish</option>
              <option value="bear">▼ Bearish</option>
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"var(--c-text4)"}}>ALERT TYPE</div>
            <select value={newType} onChange={e=>setNewType(e.target.value as Alert["type"])}
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}>
              <option value="entry">Entry Triggered</option>
              <option value="prz">Price in PRZ</option>
              <option value="target">Target Hit</option>
              <option value="stop">Stop Loss Hit</option>
            </select>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"#22c55e"}}>ENTRY PRICE (₹)</div>
            <input type="number" value={newPrice} onChange={e=>setNewPrice(e.target.value)} placeholder="e.g. 2820"
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}/>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"#e11d48"}}>STOP LOSS (₹)</div>
            <input type="number" value={newSl} onChange={e=>setNewSl(e.target.value)} placeholder="e.g. 2775"
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}/>
          </div>
          <div>
            <div className="text-[8px] mb-1" style={{...MONO,color:"#eab308"}}>TARGET 1 (₹)</div>
            <input type="number" value={newT1} onChange={e=>setNewT1(e.target.value)} placeholder="e.g. 2900"
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}/>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="text-[8px] mb-1" style={{...MONO,color:"#4ade80"}}>TARGET 2 (₹) — optional</div>
            <input type="number" value={newT2} onChange={e=>setNewT2(e.target.value)} placeholder="e.g. 2960"
              className="w-full text-[10px] px-2 py-1.5 rounded-sm border outline-none"
              style={{...MONO,background:"var(--c-muted)",borderColor:"var(--c-border)",color:"var(--c-text)"}}/>
          </div>
          <button onClick={addAlert}
            className="px-4 py-1.5 rounded-sm text-[10px] font-bold transition-all shrink-0"
            style={{...MONO,background:added?"#22c55e":"#0284c7",color:"#fff",border:"none"}}>
            {added?"✓ ADDED":"+ ADD ALERT"}
          </button>
        </div>
        <p className="text-[9px] mt-2" style={{...MONO,color:"var(--c-text4)"}}>
          Daily alerts: Entry triggered alerts fire at 9:15 AM IST if price is within 0.5% of set entry price.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-0 rounded-lg border overflow-hidden" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="px-3 py-2 border-r flex-1 flex items-center justify-between" style={{borderColor:"var(--c-border)"}}>
          <span className="text-[9px] tracking-widest" style={{...MONO,color:"var(--c-text4)"}}>
            {alerts.filter(a=>!a.triggered).length} PENDING · {alerts.filter(a=>a.triggered).length} TRIGGERED
          </span>
        </div>
        {(["all","pending","triggered"] as const).map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className="px-3 py-2 text-[9px] border-l transition-colors capitalize"
            style={{...MONO,borderColor:"var(--c-border)",background:filter===f?"rgba(2,132,199,0.1)":"transparent",
              color:filter===f?"#0284c7":"var(--c-text3)"}}>
            {f}
          </button>
        ))}
      </div>

      {/* Alert cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(a=>(
          <div key={a.id} className="rounded-lg border overflow-hidden transition-all"
            style={{
              background:"var(--c-card)",
              borderColor: a.triggered ? "var(--c-border)" : a.color,
              borderWidth: a.triggered ? 1 : 1,
              opacity: a.triggered ? 0.85 : 1,
            }}>
            {/* Top accent bar */}
            <div className="h-0.5" style={{background: a.triggered ? "var(--c-border)" : a.color}}/>

            {/* Card header */}
            <div className="p-3 border-b" style={{borderColor:"var(--c-bord2)"}}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[15px]" style={{...BEBAS,color:"var(--c-text)",letterSpacing:"1px"}}>{a.stock}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-sm"
                      style={{...MONO,background:`${a.color}14`,color:a.color,border:`1px solid ${a.color}30`}}>{a.pattern}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[8px] px-1 py-0.5 rounded"
                      style={{...MONO,background:"var(--c-muted)",color:"var(--c-text3)",border:"1px solid var(--c-bord2)"}}>{a.tf}</span>
                    <span className="text-[8px] font-bold" style={{...MONO,color:a.direction==="bull"?"#22c55e":"#e11d48"}}>
                      {a.direction==="bull"?"▲ BULLISH":"▼ BEARISH"}
                    </span>
                    <span className="text-[8px] px-1.5 py-0.5 rounded-sm font-bold"
                      style={{...MONO,background:`${typeColors[a.type]}14`,color:typeColors[a.type],border:`1px solid ${typeColors[a.type]}30`}}>
                      {typeLabel[a.type]}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {a.triggered
                    ? <div className="flex items-center gap-1 justify-end">
                        <div className="w-1.5 h-1.5 rounded-full" style={{background:"#22c55e"}}/>
                        <span className="text-[8px] font-bold" style={{...MONO,color:"#22c55e"}}>TRIGGERED</span>
                      </div>
                    : <div className="flex items-center gap-1 justify-end">
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:a.color}}/>
                        <span className="text-[8px]" style={{...MONO,color:"var(--c-text4)"}}>WAITING</span>
                      </div>
                  }
                </div>
              </div>
            </div>

            {/* Entry price (always shown) */}
            <div className="px-3 py-2 border-b" style={{borderColor:"var(--c-bord2)",background:"rgba(34,197,94,0.05)"}}>
              <div className="flex items-center justify-between">
                <span className="text-[8px] tracking-widest" style={{...MONO,color:"#22c55e"}}>ENTRY PRICE</span>
                <span className="font-bold text-[13px]" style={{...MONO,color:"var(--c-text)"}}>₹{a.price.toLocaleString("en-IN")}</span>
              </div>
            </div>

            {/* SL + Targets — always visible */}
            <div className="px-3 py-2 grid grid-cols-3 gap-2 border-b" style={{borderColor:"var(--c-bord2)"}}>
              <div className="text-center rounded py-1" style={{background:"rgba(225,29,72,0.08)"}}>
                <div className="text-[7px] tracking-widest" style={{...MONO,color:"#e11d48"}}>STOP LOSS</div>
                <div className="font-bold text-[11px] mt-0.5" style={{...MONO,color:"#e11d48"}}>₹{a.sl.toLocaleString("en-IN")}</div>
              </div>
              <div className="text-center rounded py-1" style={{background:"rgba(234,179,8,0.08)"}}>
                <div className="text-[7px] tracking-widest" style={{...MONO,color:"#eab308"}}>TARGET 1</div>
                <div className="font-bold text-[11px] mt-0.5" style={{...MONO,color:"#eab308"}}>₹{a.t1.toLocaleString("en-IN")}</div>
              </div>
              <div className="text-center rounded py-1" style={{background:"rgba(74,222,128,0.08)"}}>
                <div className="text-[7px] tracking-widest" style={{...MONO,color:"#4ade80"}}>TARGET 2</div>
                <div className="font-bold text-[11px] mt-0.5" style={{...MONO,color:"#4ade80"}}>₹{a.t2.toLocaleString("en-IN")}</div>
              </div>
            </div>

            {/* Trigger timing info */}
            <div className="px-3 py-2 border-b" style={{borderColor:"var(--c-bord2)"}}>
              <div className="flex items-center justify-between">
                <span className="text-[8px]" style={{...MONO,color:"var(--c-text4)"}}>Created: {a.createdAt}</span>
                {a.triggered && a.triggeredAt
                  ? <span className="text-[8px] font-bold" style={{...MONO,color:"#22c55e"}}>✓ {a.triggeredAt}</span>
                  : <span className="text-[8px]" style={{...MONO,color:"var(--c-text4)"}}>⏳ Waiting for entry…</span>
                }
              </div>
            </div>

            {/* Actions */}
            <div className="px-3 py-2 flex items-center gap-1.5">
              <button onClick={()=>openTradingView(a.stock,a.tf)}
                className="flex-1 text-[8px] py-1 rounded-sm font-bold transition-opacity hover:opacity-80"
                style={{...MONO,background:"rgba(2,132,199,0.12)",color:"#0284c7",border:"1px solid #0284c740"}}>
                📈 TradingView ↗
              </button>
              <button onClick={()=>openSensibull(a.stock)}
                className="flex-1 text-[8px] py-1 rounded-sm font-bold transition-opacity hover:opacity-80"
                style={{...MONO,background:"rgba(168,85,247,0.12)",color:"#a855f7",border:"1px solid #a855f740"}}>
                🔗 Sensibull ↗
              </button>
              <button onClick={()=>toggleTrigger(a.id)}
                className="text-[8px] px-1.5 py-1 rounded-sm transition-opacity hover:opacity-80"
                title={a.triggered?"Reset":"Mark triggered"}
                style={{...MONO,background:a.triggered?"var(--c-muted)":"rgba(34,197,94,0.12)",
                  color:a.triggered?"var(--c-text3)":"#22c55e",
                  border:a.triggered?"1px solid var(--c-bord2)":"1px solid rgba(34,197,94,0.3)"}}>
                {a.triggered?"↺":"✓"}
              </button>
              <button onClick={()=>removeAlert(a.id)}
                className="text-[8px] px-1.5 py-1 rounded-sm transition-opacity hover:opacity-80"
                style={{...MONO,background:"rgba(225,29,72,0.1)",color:"#e11d48",border:"1px solid rgba(225,29,72,0.25)"}}>✕</button>
            </div>
          </div>
        ))}
        {filtered.length===0&&(
          <div className="col-span-3 py-12 text-center text-[10px]" style={{...MONO,color:"var(--c-text4)"}}>
            No {filter==="all"?"alerts":filter+" alerts"} — create one above
          </div>
        )}
      </div>

      {/* Daily alert schedule */}
      <div className="rounded-lg border p-3" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="text-[9px] tracking-widest mb-2" style={{...MONO,color:"var(--c-text4)"}}>DAILY ALERT SCHEDULE (IST)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            {time:"9:15 AM",event:"Market open — Entry alerts fire",color:"#22c55e"},
            {time:"11:00 AM",event:"Mid-morning PRZ proximity check",color:"#0ea5e9"},
            {time:"2:00 PM",event:"Afternoon setup scan",color:"#f59e0b"},
            {time:"3:25 PM",event:"EOD — Swing setups for next day",color:"#a855f7"},
          ].map((s,i)=>(
            <div key={i} className="rounded p-2 text-center" style={{background:"var(--c-sub)",border:`1px solid ${s.color}20`}}>
              <div className="font-bold text-[11px]" style={{...MONO,color:s.color}}>{s.time}</div>
              <div className="text-[9px] mt-0.5" style={{...MONO,color:"var(--c-text3)"}}>{s.event}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PATTERNS TAB ─────────────────────────────────────────────────────────────
function PatternsTab({ dark }: { dark:boolean }) {
  const [selected, setSelected] = useState<Pattern>(PATTERNS[0]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-2">
        <div className="text-[9px] tracking-widest mb-2" style={{...MONO,color:"var(--c-text4)"}}>SELECT PATTERN</div>
        {PATTERNS.map(p=>(
          <button key={p.name} onClick={()=>setSelected(p)}
            className="w-full text-left rounded-lg border transition-all p-3"
            style={{
              background:selected.name===p.name?`${p.color}12`:"var(--c-card)",
              borderColor:selected.name===p.name?p.color:"var(--c-border)",
              borderWidth:selected.name===p.name?2:1,
            }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-base">{p.symbol}</span>
                <span className="font-bold" style={{...BEBAS,color:"var(--c-text)",letterSpacing:"1px",fontSize:15}}>{p.name}</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold"
                style={{...MONO,background:`${p.color}22`,color:p.color,border:`1px solid ${p.color}44`}}>{p.reliability}%</span>
            </div>
            <Bar pct={p.reliability} color={p.color}/>
            <p className="text-[10px] mt-1.5 leading-relaxed line-clamp-2" style={{...MONO,color:"var(--c-text3)"}}>{p.description}</p>
          </button>
        ))}
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="text-[9px] tracking-widest" style={{...MONO,color:"var(--c-text4)"}}>PATTERN DETAIL</div>
        <div className="rounded-lg border" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
          <div className="p-4 border-b flex items-center gap-3" style={{borderColor:"var(--c-border)"}}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
              style={{background:`${selected.color}18`,border:`1px solid ${selected.color}44`}}>{selected.symbol}</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold" style={{...BEBAS,color:"var(--c-text)",letterSpacing:"2px",fontSize:17}}>{selected.name} PATTERN</div>
              <div className="text-[9px]" style={{...MONO,color:"var(--c-text3)"}}>Reliability {selected.reliability}% · NSE Swing Strategy</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={()=>openTradingView("NIFTY50","1D")}
                className="text-[9px] px-2 py-1 rounded-sm transition-opacity hover:opacity-80"
                style={{...MONO,background:"rgba(2,132,199,0.12)",color:"#0284c7",border:"1px solid #0284c740"}}>
                TradingView ↗
              </button>
              <button onClick={()=>openSensibull("NIFTY")}
                className="text-[9px] px-2 py-1 rounded-sm transition-opacity hover:opacity-80"
                style={{...MONO,background:"rgba(168,85,247,0.12)",color:"#a855f7",border:"1px solid #a855f740"}}>
                Sensibull ↗
              </button>
            </div>
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg p-3" style={{background:"var(--c-sub)",border:`1px solid ${selected.color}20`}}>
              <div className="text-[9px] mb-2 tracking-widest" style={{...MONO,color:"var(--c-text4)"}}>DIAGRAM</div>
              <Diagram p={selected}/>
              <p className="text-[10px] mt-2 leading-relaxed" style={{...MONO,color:"var(--c-text2)"}}>{selected.description}</p>
            </div>
            <div>
              <div className="text-[9px] mb-2 tracking-widest" style={{...MONO,color:"var(--c-text4)"}}>FIBONACCI RATIOS</div>
              <div className="space-y-1.5 mb-3">
                {selected.ratios.map((r,i)=>(
                  <div key={i} className="flex items-center gap-2 rounded px-2.5 py-1.5"
                    style={{background:"var(--c-muted)",border:"1px solid var(--c-bord2)"}}>
                    <span className="w-14 text-[9px] font-bold shrink-0" style={{...MONO,color:selected.color}}>{r.leg}</span>
                    <span className="w-20 text-[9px] font-bold shrink-0" style={{...MONO,color:"var(--c-text)"}}>{r.ratio}</span>
                    <span className="text-[9px] truncate" style={{...MONO,color:"var(--c-text3)"}}>{r.note}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="rounded px-2.5 py-1.5" style={{background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)"}}>
                  <div className="text-[8px] tracking-widest mb-0.5" style={{...MONO,color:"#22c55e"}}>ENTRY</div>
                  <div className="text-[10px]" style={{...MONO,color:"var(--c-text2)"}}>{selected.entry}</div>
                </div>
                <div className="rounded px-2.5 py-1.5" style={{background:"rgba(225,29,72,0.08)",border:"1px solid rgba(225,29,72,0.2)"}}>
                  <div className="text-[8px] tracking-widest mb-0.5" style={{...MONO,color:"#e11d48"}}>STOP LOSS</div>
                  <div className="text-[10px]" style={{...MONO,color:"var(--c-text2)"}}>{selected.stop}</div>
                </div>
                <div className="rounded px-2.5 py-1.5" style={{background:"rgba(234,179,8,0.08)",border:"1px solid rgba(234,179,8,0.2)"}}>
                  <div className="text-[8px] tracking-widest mb-0.5" style={{...MONO,color:"#eab308"}}>TARGETS</div>
                  {selected.targets.map((t,i)=><div key={i} className="text-[10px]" style={{...MONO,color:"var(--c-text2)"}}>• {t}</div>)}
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="text-[9px] mb-2 tracking-widest" style={{...MONO,color:"var(--c-text4)"}}>CONFIRMATION SIGNALS</div>
            <div className="flex flex-wrap gap-1.5">
              {selected.confirmation.map((c,i)=>(
                <span key={i} className="text-[9px] px-2 py-1 rounded-sm"
                  style={{...MONO,background:`${selected.color}12`,color:selected.color,border:`1px solid ${selected.color}30`}}>{c}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-3" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
          <div className="text-[9px] tracking-widest mb-2" style={{...MONO,color:"var(--c-text4)"}}>ALL 9 PATTERNS</div>
          <div className="grid grid-cols-5 sm:grid-cols-9 gap-1.5">
            {PATTERNS.map(p=>(
              <button key={p.name} onClick={()=>setSelected(p)}
                className="rounded p-1.5 text-center border transition-all"
                style={{background:selected.name===p.name?`${p.color}15`:"var(--c-sub)",borderColor:selected.name===p.name?p.color:"var(--c-border)"}}>
                <div className="text-sm">{p.symbol}</div>
                <div className="text-[7px] mt-0.5" style={{...MONO,color:p.color}}>{p.reliability}%</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SETUP TAB ────────────────────────────────────────────────────────────────
const SETUP_STEPS = [
  { step:"01", title:"Screen Stocks", time:"Pre-market 8:30–9:00 AM",
    desc:"Filter F&O stocks with ADV > 5L shares, price > ₹200. Prefer Nifty 100 for liquidity.",
    tools:["NSE Website","TradingView Screener","Chartink"] },
  { step:"02", title:"Identify Swing Points", time:"Pre-market or EOD",
    desc:"Mark XABCD pivots on 1D or 4H chart. Use ZigZag indicator to find significant highs/lows.",
    tools:["TradingView ZigZag","Fibonacci Tool"] },
  { step:"03", title:"Validate Fibonacci Ratios", time:"Before market open",
    desc:"Apply Fib tool X→A, A→B, B→C. Verify each leg falls within the pattern's tolerance range.",
    tools:["TradingView Fib Tool","Harmonic Indicator"] },
  { step:"04", title:"Mark PRZ Zone", time:"Pre-market",
    desc:"PRZ = cluster of Fibonacci levels. Mark ±0.5% zone around D point.",
    tools:["Rectangle Tool","Fib Extension"] },
  { step:"05", title:"Wait for Confirmation", time:"9:15–11:00 AM or 1:30–3:00 PM",
    desc:"Never enter at PRZ without confirmation. Wait for reversal candle + volume spike.",
    tools:["Volume Profile","RSI","MACD"] },
  { step:"06", title:"Execute via Kite", time:"During market hours",
    desc:"Bracket order on Zerodha Kite. Entry = confirmation candle close. SL = beyond X.",
    tools:["Zerodha Kite","GTT Orders"] },
];

function SetupTab() {
  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="rounded-lg border p-4" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="text-[9px] tracking-widest mb-1" style={{...MONO,color:"var(--c-text4)"}}>NSE HARMONIC WORKFLOW</div>
        <p className="text-[11px]" style={{...MONO,color:"var(--c-text2)"}}>Step-by-step process from screening to execution on Zerodha Kite.</p>
      </div>
      {SETUP_STEPS.map((s,i)=>(
        <div key={i} className="rounded-lg border flex overflow-hidden" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
          <div className="w-14 shrink-0 flex items-center justify-center"
            style={{background:"rgba(2,132,199,0.08)",borderRight:"1px solid var(--c-border)"}}>
            <span style={{...BEBAS,color:"#0284c7",fontSize:20,letterSpacing:"1px"}}>{s.step}</span>
          </div>
          <div className="p-3 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
              <span className="font-bold" style={{...BEBAS,color:"var(--c-text)",letterSpacing:"1px",fontSize:15}}>{s.title}</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded-sm"
                style={{...MONO,background:"rgba(234,88,12,0.1)",color:"#ea580c",border:"1px solid rgba(234,88,12,0.3)"}}>{s.time}</span>
            </div>
            <p className="text-[10px] mb-2 leading-relaxed" style={{...MONO,color:"var(--c-text2)"}}>{s.desc}</p>
            <div className="flex flex-wrap gap-1">
              {s.tools.map((t,j)=>(
                <span key={j} className="text-[8px] px-1.5 py-0.5 rounded-sm"
                  style={{...MONO,background:"var(--c-muted)",color:"var(--c-text3)",border:"1px solid var(--c-bord2)"}}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
      <div className="rounded-lg border p-4" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="text-[9px] tracking-widest mb-3" style={{...MONO,color:"var(--c-text4)"}}>OPTIMAL NSE WINDOWS (IST)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {label:"MORNING PRIME",time:"9:15–10:30 AM",desc:"Highest volatility. Best for breakouts.",color:"#22c55e"},
            {label:"MIDDAY QUIET", time:"11:00 AM–1:00 PM",desc:"Low noise. Let setups mature.",color:"#f59e0b"},
            {label:"AFTERNOON",   time:"1:30–3:20 PM",desc:"Institutional activity. Good reversals.",color:"#0ea5e9"},
          ].map((w,i)=>(
            <div key={i} className="rounded-lg p-3 text-center" style={{background:"var(--c-sub)",border:`1px solid ${w.color}22`}}>
              <div className="text-[8px] tracking-widest" style={{...MONO,color:w.color}}>{w.label}</div>
              <div className="font-bold my-1" style={{...BEBAS,color:"var(--c-text)",fontSize:15,letterSpacing:"1px"}}>{w.time}</div>
              <div className="text-[9px]" style={{...MONO,color:"var(--c-text3)"}}>{w.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── RISK TAB ─────────────────────────────────────────────────────────────────
const RISKS = [
  { icon:"📊", title:"Gap Risk",         desc:"NSE stocks gap on global cues. Pattern PRZ can be blown overnight. Use weekly for swing trades." },
  { icon:"📰", title:"Earnings Risk",    desc:"Results season (Apr/Jul/Oct/Jan) causes unpredictable moves. Avoid 3 days before results." },
  { icon:"🔒", title:"Circuit Breakers", desc:"NSE 5/10/20% circuits halt trading. Prefer Nifty 50/100 stocks. Avoid small caps." },
  { icon:"🌍", title:"FII/DII Flows",    desc:"Foreign outflows override technicals. Check NSE FII data daily before trading." },
  { icon:"⏰", title:"Time Decay (F&O)", desc:"Options lose value daily. Prefer cash/futures for > 5 day setups." },
  { icon:"💧", title:"Liquidity Risk",   desc:"Far OTM strikes have wide bid-ask. Only trade near-ATM strikes with > 50K OI." },
];

function RiskTab() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {RISKS.map((r,i)=>(
          <div key={i} className="rounded-lg border p-4" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{r.icon}</span>
              <span style={{...BEBAS,color:"var(--c-text)",letterSpacing:"1px",fontSize:15}}>{r.title}</span>
            </div>
            <p className="text-[10px] leading-relaxed" style={{...MONO,color:"var(--c-text2)"}}>{r.desc}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-4" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="text-[9px] tracking-widest mb-3" style={{...MONO,color:"var(--c-text4)"}}>POSITION SIZING</div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            {label:"MAX RISK/TRADE",value:"1–2%",sub:"of total capital",color:"#e11d48"},
            {label:"MIN R:R RATIO", value:"1:2", sub:"never below this", color:"#22c55e"},
            {label:"MAX OPEN",      value:"3–4", sub:"concurrent setups",color:"#0ea5e9"},
          ].map((m,i)=>(
            <div key={i} className="rounded-lg p-3 text-center" style={{background:"var(--c-sub)",border:`1px solid ${m.color}22`}}>
              <div className="text-[8px] tracking-widest" style={{...MONO,color:m.color}}>{m.label}</div>
              <div className="font-bold my-1" style={{...BEBAS,color:"var(--c-text)",fontSize:22}}>{m.value}</div>
              <div className="text-[9px]" style={{...MONO,color:"var(--c-text3)"}}>{m.sub}</div>
            </div>
          ))}
        </div>
        <div className="rounded px-3 py-2" style={{background:"rgba(2,132,199,0.08)",border:"1px solid rgba(2,132,199,0.2)"}}>
          <div className="text-[8px] tracking-widest mb-1" style={{...MONO,color:"#0284c7"}}>FORMULA</div>
          <div className="text-[10px]" style={{...MONO,color:"var(--c-text2)"}}>Position Size = (Capital × Risk%) ÷ (Entry − Stop Loss)</div>
        </div>
      </div>
      <div className="rounded-lg border p-4" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="text-[9px] tracking-widest mb-3" style={{...MONO,color:"var(--c-text4)"}}>PRE-TRADE CHECKLIST</div>
        <div className="space-y-1.5">
          {["Pattern ratios validated?","PRZ zone identified?","Confirmation candle at D?","Volume spike at reversal?",
            "R:R ≥ 1:2 calculated?","Stop beyond X placed?","No results within 3 days?","Nifty direction aligned?",
            "Position size ≤ 2% risk?","GTT order on Kite placed?"].map((item,i)=>(
            <div key={i} className="flex items-center gap-3 rounded px-3 py-2"
              style={{background:i%2===0?"var(--c-sub)":"var(--c-muted)",border:"1px solid var(--c-bord2)"}}>
              <div className="w-4 h-4 rounded border-2 shrink-0" style={{borderColor:"var(--c-border)"}}/>
              <span className="text-[10px]" style={{...MONO,color:"var(--c-text2)"}}>{item}</span>
              <span className="ml-auto text-[7px] shrink-0" style={{...MONO,color:"#e11d48"}}>REQ</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function HarmonicsPage() {
  const [dark, setDark]         = useState(true);
  const [tab,  setTab]          = useState<"patterns"|"scan"|"alerts"|"setup"|"risk">("patterns");
  const [kiteUser, setKiteUser] = useState("");

  useEffect(() => {
    try {
      const s = localStorage.getItem("dark_mode");
      if (s==="1") setDark(true);
      else if (s==="0") setDark(false);
      const u = localStorage.getItem("kite_user");
      if (u) setKiteUser(u);
    } catch {}
  }, []);

  const th = {
    "--c-bg":     dark?"#0d1117":"#f0f4f8",
    "--c-card":   dark?"#161b22":"#ffffff",
    "--c-sub":    dark?"#1c2128":"#fafbfc",
    "--c-muted":  dark?"#21262d":"#f1f5f9",
    "--c-text":   dark?"#c9d1d9":"#1e293b",
    "--c-text2":  dark?"#8b949e":"#475569",
    "--c-text3":  dark?"#6e7681":"#64748b",
    "--c-text4":  dark?"#484f58":"#94a3b8",
    "--c-border": dark?"#30363d":"#cbd5e1",
    "--c-bord2":  dark?"#21262d":"#e2e8f0",
    "--c-row2":   dark?"#1a1f27":"#fafafa",
  } as React.CSSProperties;

  const TABS = [
    {id:"patterns", label:"📐 Patterns"},
    {id:"scan",     label:"🔍 NSE Scan"},
    {id:"alerts",   label:"🔔 Alerts"},
    {id:"setup",    label:"⚙️ Setup"},
    {id:"risk",     label:"⚠️ Risk"},
  ] as const;

  return (
    <div style={{...th,background:"var(--c-bg)",color:"var(--c-text)",minHeight:"100vh"}} data-dark={dark}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b" style={{background:"var(--c-card)",borderColor:"var(--c-border)"}}>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-12 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <a href="/options" className="shrink-0 text-[9px] px-2 py-1 rounded-sm border hover:opacity-70 transition-opacity"
              style={{...MONO,borderColor:"var(--c-border)",color:"var(--c-text3)"}}>← BACK</a>
            <div className="w-px h-4 shrink-0" style={{background:"var(--c-border)"}}/>
            <span className="font-bold" style={{...BEBAS,color:"var(--c-text)",letterSpacing:"2px",fontSize:15}}>HARMONIC PATTERNS</span>
            <span className="hidden sm:inline text-[8px] px-1.5 py-0.5 rounded-sm font-bold"
              style={{...MONO,background:"#0284c722",color:"#0284c7",border:"1px solid #0284c744"}}>NSE · 9 PATTERNS</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {kiteUser && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-sm border"
                style={{...MONO,borderColor:"#22c55e40",background:"#22c55e08",color:"#22c55e",fontSize:9}}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"/>
                {kiteUser}
              </div>
            )}
            <button onClick={()=>setDark(d=>!d)}
              className="text-[9px] px-2 py-1 rounded-sm border"
              style={{...MONO,borderColor:"var(--c-border)",color:"var(--c-text3)"}}>
              {dark?"☀️ LIGHT":"🌙 DARK"}
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 flex border-t overflow-x-auto" style={{borderColor:"var(--c-border)"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className="px-3 sm:px-4 py-2 text-[10px] border-b-2 whitespace-nowrap transition-colors"
              style={{...MONO,borderColor:tab===t.id?"#0284c7":"transparent",color:tab===t.id?"#0284c7":"var(--c-text3)",background:"transparent"}}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4">
        {tab==="patterns" && <PatternsTab dark={dark}/>}
        {tab==="scan"     && <ScanTab dark={dark}/>}
        {tab==="alerts"   && <AlertsTab dark={dark}/>}
        {tab==="setup"    && <SetupTab/>}
        {tab==="risk"     && <RiskTab/>}
      </div>

      <div className="border-t mt-8 py-4" style={{borderColor:"var(--c-border)"}}>
        <div className="max-w-7xl mx-auto px-4 text-center text-[8px]" style={{...MONO,color:"var(--c-text4)"}}>
          HARMONIC PATTERNS · NSE SWING STRATEGY · EDUCATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE
        </div>
      </div>
    </div>
  );
}
