// ─── Black-Scholes ────────────────────────────────────────────────────────────
function normCDF(x: number): number {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}
function normPDF(x:number){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}

export function bs(S:number,K:number,T:number,r:number,sigma:number,type:"CE"|"PE"){
  if(T<=0)T=0.0001;
  const sq=Math.sqrt(T);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*sq);
  const d2=d1-sigma*sq;
  const price=type==="CE"?S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2):K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
  const delta=type==="CE"?normCDF(d1):normCDF(d1)-1;
  const gamma=normPDF(d1)/(S*sigma*sq);
  const theta=type==="CE"?(-S*normPDF(d1)*sigma/(2*sq)-r*K*Math.exp(-r*T)*normCDF(d2))/365:(-S*normPDF(d1)*sigma/(2*sq)+r*K*Math.exp(-r*T)*normCDF(-d2))/365;
  const vega=S*normPDF(d1)*sq/100;
  return {price:+Math.max(price,0.05).toFixed(2),delta:+delta.toFixed(4),gamma:+gamma.toFixed(6),theta:+theta.toFixed(2),vega:+vega.toFixed(2),iv:+(sigma*100).toFixed(2)};
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface OptionLeg {
  token:number; strike:number; type:"CE"|"PE";
  tradingsymbol?:string;
  ltp:number; prevLtp:number; ltpChange:number;
  oi:number; oiChange:number; volume:number;
  iv:number; delta:number; gamma:number; theta:number; vega:number;
  bid:number; ask:number; oiVolRatio:number; moveScore:number;
}
export interface OptionsRow {
  strike:number; isATM:boolean;
  ce:OptionLeg; pe:OptionLeg;
  ceOIBar:number; peOIBar:number;
}
export interface OptionsChainData {
  spot:number; expiry:string; daysToExpiry:number;
  rows:OptionsRow[]; pcr:number; pcrOI:number;
  maxPain:number; totalCEOI:number; totalPEOI:number;
  atmIV:number; updatedAt:string;
}
export interface ScanResult {
  leader: OptionLeg|null;      // selected option (lower OI/Vol side)
  ce: OptionLeg|null;          // best CE candidate (lowest CE OI/Vol, LTP ≥ 200)
  pe: OptionLeg|null;          // best PE candidate (lowest PE OI/Vol, LTP ≥ 200)
  ceOIVol: number;             // best CE's OI/Vol ratio
  peOIVol: number;             // best PE's OI/Vol ratio
  atmIV: number;               // ATM IV at scan time (for vol-based SL)
  usedMin?: number;            // actual LTP threshold used (200 preferred, may fall back)
  scanTime: string; spot: number; active: boolean;
  topCEs?: OptionLeg[]; topPEs?: OptionLeg[];
}
export interface RRLevels {
  entry:number; sl:number; target1:number; target2:number;
  risk:number; reward:number; riskPct:number; rewardPct:number;
}
export interface WatchedOption {
  leg:OptionLeg; entryPrice:number; rr:RRLevels;
  addedAt:string; status:"ACTIVE"|"TARGET"|"SL"|"EXPIRED"|"TIME_PROFIT"|"TIME_EXIT";
  currentPnL:number; pnlPct:number;
  expiry?:string; exchange?:string;
}

// ─── 9:26 AM Scanner ─────────────────────────────────────────────────────────
// Logic: LTP ≥ ₹200 at 9:15 AM. Compare OI/Vol ratio for CE vs PE.
// Lower OI/Vol = more volume relative to OI = stronger conviction = Leader.
export function runScanner(rows:OptionsRow[], spot:number, atmIV=15, minPremium=200):ScanResult {
  function filterLegs(threshold:number){
    const ces:OptionLeg[]=[], pes:OptionLeg[]=[];
    rows.forEach(r=>{
      if(r.ce.ltp>=threshold) ces.push(r.ce);
      if(r.pe.ltp>=threshold) pes.push(r.pe);
    });
    return {ces,pes};
  }

  // Try ≥200 first; fall back progressively so post-market / demo data still shows results
  let {ces,pes} = filterLegs(minPremium);
  let usedMin = minPremium;
  if(!ces.length && !pes.length) { ({ces,pes}=filterLegs(100)); usedMin=100; }
  if(!ces.length && !pes.length) { ({ces,pes}=filterLegs(50));  usedMin=50;  }
  if(!ces.length && !pes.length) {
    // last resort: all legs with any positive LTP
    rows.forEach(r=>{ if(r.ce.ltp>0) ces.push(r.ce); if(r.pe.ltp>0) pes.push(r.pe); });
    usedMin=0;
  }

  // Sort by oiVolRatio ascending (lower = stronger conviction); push 999/Inf to end
  const sortedCEs=[...ces].sort((a,b)=>a.oiVolRatio-b.oiVolRatio);
  const sortedPEs=[...pes].sort((a,b)=>a.oiVolRatio-b.oiVolRatio);

  const bestCE=sortedCEs[0]??null;
  const bestPE=sortedPEs[0]??null;

  const ceOIVol=bestCE?.oiVolRatio??Infinity;
  const peOIVol=bestPE?.oiVolRatio??Infinity;

  // Leader = whichever side has lower OI/Vol ratio (more conviction)
  let leader:OptionLeg|null=null;
  if(bestCE&&bestPE) leader=ceOIVol<=peOIVol?bestCE:bestPE;
  else leader=bestCE??bestPE;

  return {
    leader, ce:bestCE, pe:bestPE,
    ceOIVol:ceOIVol===Infinity?0:+ceOIVol.toFixed(3),
    peOIVol:peOIVol===Infinity?0:+peOIVol.toFixed(3),
    atmIV, usedMin,
    scanTime:now926(), spot, active:!!leader,
    topCEs:sortedCEs.slice(0,5), topPEs:sortedPEs.slice(0,5),
  };
}

// ─── Risk/Reward 1:2 — fixed 12% SL, 24% target ─────────────────────────────
export function calcRR(entry:number, _atmIV=15):RRLevels {
  const risk=+(entry*0.12).toFixed(2);
  const reward=+(entry*0.24).toFixed(2);
  return { entry, sl:+(entry-risk).toFixed(2), target1:+(entry+risk).toFixed(2), target2:+(entry+reward).toFixed(2), risk, reward, riskPct:12, rewardPct:24 };
}

export function calcPnL(current:number,rr:RRLevels):{pnl:number;pct:number;status:WatchedOption["status"]}{
  const pnl=+(current-rr.entry).toFixed(2);
  const pct=+(pnl/rr.entry*100).toFixed(2);
  let status:WatchedOption["status"]="ACTIVE";
  if(current<=rr.sl)status="SL";
  else if(current>=rr.target2)status="TARGET";
  return {pnl,pct,status};
}

// ─── PCR + Max Pain ──────────────────────────────────────────────────────────
export function calcPCR(rows:OptionsRow[]){
  const cv=rows.reduce((s,r)=>s+r.ce.volume,0),pv=rows.reduce((s,r)=>s+r.pe.volume,0);
  const co=rows.reduce((s,r)=>s+r.ce.oi,0),po=rows.reduce((s,r)=>s+r.pe.oi,0);
  return {pcrVol:cv>0?+(pv/cv).toFixed(3):0,pcrOI:co>0?+(po/co).toFixed(3):0,totalCEOI:co,totalPEOI:po};
}
export function calcMaxPain(rows:OptionsRow[]):number{
  let min=Infinity,mp=rows[0]?.strike??0;
  for(const {strike:exp} of rows){
    let loss=0;
    for(const {strike:s,ce,pe} of rows){if(exp>s)loss+=(exp-s)*ce.oi;if(exp<s)loss+=(s-exp)*pe.oi;}
    if(loss<min){min=loss;mp=exp;}
  }
  return mp;
}

// ─── RSI ─────────────────────────────────────────────────────────────────────
// Wilder's smoothed RSI. Returns null if not enough candles yet (need period+1)
export function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return +(100 - 100 / (1 + ag / al)).toFixed(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function getNiftyExpiries():string[]{
  const out:string[]=[]; const now=new Date();
  for(let i=0;i<35;i++){const d=new Date(now);d.setDate(now.getDate()+i);if(d.getDay()===4){out.push(d.toISOString().split("T")[0]);if(out.length>=6)break;}}
  return out;
}
export function daysToExpiry(exp:string):number{
  const d=new Date(exp);d.setHours(15,30,0,0);
  return Math.max((d.getTime()-Date.now())/86400000,0.001);
}
export function getATM(spot:number,step=50):number{return Math.round(spot/step)*step;}
export function now926():string{return new Date().toLocaleTimeString("en-IN",{hour12:false});}
export function is926():boolean{const n=new Date(),h=n.getHours(),m=n.getMinutes();return(h===9&&m>=26)||(h>9);}
export function fmtOI(n:number):string{return n>=100000?`${(n/100000).toFixed(1)}L`:n>=1000?`${(n/1000).toFixed(0)}K`:`${n}`;}
