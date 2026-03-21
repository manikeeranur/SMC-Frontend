import { bs, getATM, getNiftyExpiries, daysToExpiry, calcPCR, calcMaxPain } from "./options";
import type { OptionsChainData, OptionsRow, OptionLeg } from "./options";

const BASE_SPOT = 22400;
const R = 0.065;
const STEP = 50;
const N_EACH = 15;

let spot = BASE_SPOT;
let t = 0;
const oiBase: Record<string, { ce: number; pe: number }> = {};
const tokenMap: Record<string, number> = {};
let tc = 200000;

function tok(strike: number, type: "CE" | "PE") {
  const k = `${strike}-${type}`;
  return (tokenMap[k] = tokenMap[k] ?? ++tc);
}

function baseOI(strike: number, atm: number) {
  const k = String(strike);
  if (!oiBase[k]) {
    const dist = Math.abs(strike - atm) / STEP;
    const f = Math.exp(-0.06 * dist) * (0.5 + Math.random() * 1.0);
    oiBase[k] = {
      ce: Math.round(f * (strike >= atm ? 4_000_000 : 2_000_000)),
      pe: Math.round(f * (strike <= atm ? 4_000_000 : 2_000_000)),
    };
  }
  return oiBase[k];
}

export function generateChain(expiry?: string): OptionsChainData {
  t++;
  spot = BASE_SPOT + Math.sin(t * 0.04) * 200 + Math.cos(t * 0.07) * 80 + (Math.random() - 0.5) * 15;
  const exps = getNiftyExpiries();
  const exp = expiry ?? exps[0];
  const T = daysToExpiry(exp) / 365;
  const atm = getATM(spot);

  const strikes: number[] = [];
  for (let i = -N_EACH; i <= N_EACH; i++) strikes.push(atm + i * STEP);

  const rows: OptionsRow[] = strikes.map((K) => {
    const mono = Math.log(K / spot);
    const iv = Math.max(0.16 + 0.05 * mono * mono - 0.02 * mono + Math.random() * 0.008, 0.09);
    const ceBs = bs(spot, K, T, R, iv, "CE");
    const peBs = bs(spot, K, T, R, iv, "PE");
    const oib = baseOI(K, atm);

    const ceOI = Math.max(oib.ce + (t % 4 === 0 ? Math.round((Math.random() - 0.48) * oib.ce * 0.015) : 0), 0);
    const peOI = Math.max(oib.pe + (t % 4 === 0 ? Math.round((Math.random() - 0.48) * oib.pe * 0.015) : 0), 0);
    const ceVol = Math.round(ceOI * 0.04 * (0.5 + Math.random() * 1.5));
    const peVol = Math.round(peOI * 0.04 * (0.5 + Math.random() * 1.5));
    const ceOIChange = t % 4 === 0 ? Math.round((Math.random() - 0.48) * oib.ce * 0.015) : 0;
    const peOIChange = t % 4 === 0 ? Math.round((Math.random() - 0.48) * oib.pe * 0.015) : 0;

    const ceLtp = +Math.max(ceBs.price * (1 + (Math.random() - 0.5) * 0.004), 0.05).toFixed(2);
    const peLtp = +Math.max(peBs.price * (1 + (Math.random() - 0.5) * 0.004), 0.05).toFixed(2);

    const makeLeg = (type: "CE" | "PE", ltp: number, prev: number, oi: number, oiChg: number, vol: number, oivr: number, grec: ReturnType<typeof bs>): OptionLeg => ({
      token: tok(K, type), strike: K, type,
      ltp, prevLtp: prev, ltpChange: +(ltp - prev).toFixed(2),
      oi, oiChange: oiChg, volume: vol,
      iv: grec.iv, delta: grec.delta, gamma: grec.gamma, theta: grec.theta, vega: grec.vega,
      bid: +(ltp * 0.996).toFixed(2), ask: +(ltp * 1.004).toFixed(2),
      oiVolRatio: vol > 0 ? +(oi / vol).toFixed(1) : 999, moveScore: 0,
    });

    return {
      strike: K, isATM: K === atm,
      ce: makeLeg("CE", ceLtp, +ceBs.price.toFixed(2), ceOI, ceOIChange, ceVol, ceVol > 0 ? +(ceOI/ceVol).toFixed(1) : 999, ceBs),
      pe: makeLeg("PE", peLtp, +peBs.price.toFixed(2), peOI, peOIChange, peVol, peVol > 0 ? +(peOI/peVol).toFixed(1) : 999, peBs),
      ceOIBar: 0, peOIBar: 0,
    };
  });

  const maxCE = Math.max(...rows.map(r => r.ce.oi));
  const maxPE = Math.max(...rows.map(r => r.pe.oi));
  rows.forEach(r => { r.ceOIBar = maxCE > 0 ? (r.ce.oi/maxCE)*100 : 0; r.peOIBar = maxPE > 0 ? (r.pe.oi/maxPE)*100 : 0; });

  const { pcrVol, pcrOI, totalCEOI, totalPEOI } = calcPCR(rows);
  const maxPain = calcMaxPain(rows);
  const atmRow  = rows.find(r => r.isATM);

  return {
    spot: +spot.toFixed(2), expiry: exp,
    daysToExpiry: +daysToExpiry(exp).toFixed(2),
    rows, pcr: pcrVol, pcrOI, maxPain,
    totalCEOI, totalPEOI,
    atmIV: atmRow?.ce.iv ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

export { getNiftyExpiries };
