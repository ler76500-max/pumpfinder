const ONE_HOUR = 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function momentum(trades) {
  if (!Array.isArray(trades) || trades.length < 8) {
    return { state: "INSUFFICIENT_DATA", note: "Pas assez de données" };
  }

  const p = trades.filter(t => num(t.price) > 0);
  if (p.length < 8) {
    return { state: "INSUFFICIENT_DATA", note: "Prix insuffisant" };
  }

  const recent = p.slice(-8);
  const previous = p.slice(-16, -8);
  const current = num(recent.at(-1).price);
  const prevAvg = previous.length
    ? previous.reduce((s,t) => s + num(t.price), 0) / previous.length
    : current;

  let peak = 0;
  for (const t of p.slice(0, -8)) peak = Math.max(peak, num(t.price));

  const pullback = peak > 0 ? (peak - current) / peak : 0;
  const recovery = prevAvg > 0 ? (current - prevAvg) / prevAvg : 0;

  if (pullback >= 0.08 && recovery >= 0.03)
    return { state: "REBOUND_WATCH", note: "Correction puis rebond observé" };
  if (recovery >= 0.03)
    return { state: "MOMENTUM_UP", note: "Momentum haussier observé" };
  if (pullback >= 0.08)
    return { state: "PULLBACK", note: "Correction observée" };
  return { state: "NEUTRAL", note: "Pas de configuration claire" };
}

export class Engine {
  constructor({ capitalEUR = 20, minScore = 85, maxCandidates = 20 } = {}) {
    this.capitalEUR = capitalEUR;
    this.minScore = minScore;
    this.maxCandidates = maxCandidates;
    this.tokens = new Map();
    this.lastSignal = null;
  }

  ingest(trade) {
    if (!trade?.mint || !trade?.side) return;

    let token = this.tokens.get(trade.mint);
    if (!token) {
      token = { mint: trade.mint, symbol: trade.symbol || "?", name: trade.name || "", trades: [] };
      this.tokens.set(trade.mint, token);
    }

    if (trade.symbol && trade.symbol !== "?") token.symbol = trade.symbol;
    if (trade.name) token.name = trade.name;

    token.trades.push({
      ...trade,
      time: num(trade.time, Date.now()),
      quoteSOL: num(trade.quoteSOL),
      price: num(trade.price)
    });

    const cutoff = Date.now() - ONE_HOUR;
    token.trades = token.trades.filter(t => t.time >= cutoff).slice(-1000);
  }

  analyze(token) {
    const trades = token.trades || [];
    const now = Date.now();
    const last5 = trades.filter(t => now - t.time <= FIVE_MIN);

    const buys = trades.filter(t => t.side === "BUY");
    const sells = trades.filter(t => t.side === "SELL");
    const buyVol = buys.reduce((s,t) => s + num(t.quoteSOL), 0);
    const sellVol = sells.reduce((s,t) => s + num(t.quoteSOL), 0);
    const totalVol = buyVol + sellVol;

    const recentVol = last5.reduce((s,t) => s + num(t.quoteSOL), 0);
    const old = trades.filter(t => now - t.time > FIVE_MIN);
    const oldVol = old.reduce((s,t) => s + num(t.quoteSOL), 0);
    const oldMinutes = old.length
      ? Math.max(1, Math.min(55, (now - old[0].time) / 60000))
      : 55;
    const oldPer5 = oldVol * 5 / oldMinutes;

    const activity = Math.min(100, Math.log10(1 + recentVol) * 45);
    const pressure = totalVol > 0 ? buyVol / totalVol * 100 : 0;
    const acceleration = oldPer5 > 0
      ? Math.min(100, recentVol / oldPer5 * 50)
      : Math.min(100, recentVol * 25);

    const traders = new Set(trades.map(t => t.trader).filter(Boolean));
    const diversity = Math.min(100, traders.size * 10);

    const prices = trades.filter(t => num(t.price) > 0).map(t => num(t.price));
    let priceChange = 0;
    let volatility = 0;

    if (prices.length >= 2) {
      const first = prices[0];
      const last = prices.at(-1);
      priceChange = first > 0 ? (last - first) / first * 100 : 0;
      const mean = prices.reduce((s,p) => s+p, 0) / prices.length;
      const variance = prices.reduce((s,p) => s + (p-mean)**2, 0) / prices.length;
      volatility = mean > 0 ? Math.min(20, Math.sqrt(variance) / mean * 100) : 0;
    }

    const maxTrade = trades.reduce((m,t) => Math.max(m, num(t.quoteSOL)), 0);
    const concentration = totalVol > 0 ? maxTrade / totalVol : 0;
    const concentrationPenalty = Math.min(20, concentration * 20);

    const score = Math.max(0, Math.min(100,
      activity * .20 +
      pressure * .25 +
      acceleration * .20 +
      diversity * .15 +
      Math.max(0, Math.min(100, 50 + priceChange * 2)) * .20 -
      volatility -
      concentrationPenalty
    ));

    const enough = last5.length >= 5 && trades.length >= 12;
    const action = enough && score >= this.minScore ? "BUY_POSSIBLE" : "WAIT";

    return {
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      score: Number(score.toFixed(1)),
      action,
      reason: !enough
        ? `NO_SIGNAL — données insuffisantes (${last5.length} trades/5m, ${trades.length} trades/1h)`
        : action === "BUY_POSSIBLE"
          ? "Configuration favorable observée — décision manuelle uniquement"
          : "Pas assez de confirmation",
      momentumState: momentum(trades),
      trades5m: last5.length,
      trades1h: trades.length,
      buyVolumeSOL: Number(buyVol.toFixed(4)),
      sellVolumeSOL: Number(sellVol.toFixed(4)),
      volume5mSOL: Number(recentVol.toFixed(4)),
      priceChangePct: Number(priceChange.toFixed(2)),
      traders: traders.size,
      capitalEUR: this.capitalEUR,
      updatedAt: new Date().toISOString()
    };
  }

  candidates() {
    return Array.from(this.tokens.values())
      .map(t => this.analyze(t))
      .sort((a,b) => b.score - a.score)
      .slice(0, this.maxCandidates);
  }

  bestSignal() {
    const best = this.candidates()[0];
    if (!best || best.action !== "BUY_POSSIBLE") return null;
    this.lastSignal = best;
    return best;
  }

  status() {
    return {
      tokens: this.tokens.size,
      totalTrades: Array.from(this.tokens.values()).reduce((s,t) => s + t.trades.length, 0),
      lastSignal: this.lastSignal
    };
  }
}
