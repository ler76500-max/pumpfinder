const HOUR = 60 * 60 * 1000;
const MAX_TOKENS = 5000;

export class Engine {
  constructor({ capitalEUR = 20, minScore = 85, maxCandidates = 20 }) {
    this.capitalEUR = capitalEUR;
    this.minScore = minScore;
    this.maxCandidates = maxCandidates;
    this.map = new Map();
    this.totalTrades = 0;
    this.lastIngest = null;
  }

  ingest(t) {
    if (!t?.mint || !Number.isFinite(t.time) || !Number.isFinite(t.usd)) return;

    let c = this.map.get(t.mint);

    if (!c) {
      c = {
        mint: t.mint,
        symbol: t.symbol || "?",
        name: t.name || "",
        trades: [],
        first: t.time,
        last: t.time
      };
      this.map.set(t.mint, c);
    }

    c.symbol = t.symbol || c.symbol;
    c.name = t.name || c.name;
    c.trades.push(t);
    c.last = Math.max(c.last, t.time);
    this.totalTrades++;
    this.lastIngest = new Date().toISOString();

    // Keep only the last hour of data per token.
    const cutoff = Date.now() - HOUR;
    c.trades = c.trades.filter(x => x.time >= cutoff);

    // Prevent an unbounded number of tokens in a long-running process.
    if (this.map.size > MAX_TOKENS) this.prune();
  }

  prune() {
    const entries = [...this.map.values()]
      .sort((a, b) => b.last - a.last);

    for (const c of entries.slice(MAX_TOKENS)) {
      this.map.delete(c.mint);
    }
  }

  candidates() {
    const out = [];

    for (const c of this.map.values()) {
      const result = this.analyze(c);
      if (result) out.push(result);
    }

    return out
      .sort((a, b) => {
        const signalRank = Number(b.action !== "NO_SIGNAL") - Number(a.action !== "NO_SIGNAL");
        return signalRank || b.score - a.score || b.metrics.volume5mUSD - a.metrics.volume5mUSD;
      })
      .slice(0, this.maxCandidates);
  }

  bestSignal() {
    const top = [...this.map.values()]
      .map(c => this.analyze(c))
      .filter(Boolean)
      .filter(x => x.action === "BUY_POSSIBLE")
      .sort((a, b) => b.score - a.score)[0];

    return top || null;
  }

  analyze(c) {
    const now = Date.now();

    const recent = c.trades.filter(x => x.time >= now - 5 * 60 * 1000);
    const last15 = c.trades.filter(x => x.time >= now - 15 * 60 * 1000);
    const hour = c.trades;

    if (!hour.length) return null;

    const volume5 = sum(recent, x => x.usd);
    const volume10 = sum(hour.filter(x => x.time >= now - 10 * 60 * 1000), x => x.usd);
    const volume15 = sum(last15, x => x.usd);
    const older10 = hour.filter(
      x => x.time >= now - 15 * 60 * 1000 && x.time < now - 5 * 60 * 1000
    );
    const oldVol = sum(older10, x => x.usd);

    const buys = recent.filter(x => x.side === "BUY").length;
    const sells = recent.filter(x => x.side === "SELL").length;
    const buyRatio = recent.length ? buys / recent.length : 0;

    const traders5 = new Set(recent.map(x => x.trader).filter(Boolean)).size;
    const traders1h = new Set(hour.map(x => x.trader).filter(Boolean)).size;

    const recentPrices = recent
      .slice()
      .sort((a, b) => a.time - b.time)
      .map(x => x.price)
      .filter(Number.isFinite);

    const hourPrices = hour
      .slice()
      .sort((a, b) => a.time - b.time)
      .map(x => x.price)
      .filter(Number.isFinite);

    const ret5 = percentageChange(recentPrices);
    const ret1h = percentageChange(hourPrices);
    const acceleration = oldVol > 0 ? volume5 / (oldVol / 2) : null;

    const enough5m = recent.length >= 5;
    const enough1h = hour.length >= 12;

    // No fabricated score: until minimum evidence exists, return NO_SIGNAL.
    if (!enough5m || !enough1h) {
      return this.noSignal(c, {
        recent,
        hour,
        volume5,
        volume10,
        volume15,
        buyRatio,
        traders5,
        traders1h,
        ret5,
        ret1h,
        acceleration,
        reason: !enough5m
          ? "Pas assez de trades sur 5 minutes."
          : "Pas encore assez d'historique sur 1 heure."
      });
    }

    const activityScore = clamp(scaleLog(volume5, 100, 50000));
    const pressureScore = clamp(buyRatio * 100);
    const accelScore = clamp(scaleLog(acceleration || 0, 0.5, 8));
    const diversityScore = clamp((traders5 / Math.max(recent.length, 1)) * 130);
    const consistencyScore = clamp(50 + Math.max(-30, Math.min(30, ret5)) * 1.5);
    const volatilityPenalty = estimateVolatility(recentPrices);

    let score =
      activityScore * 0.22 +
      pressureScore * 0.24 +
      accelScore * 0.18 +
      diversityScore * 0.18 +
      consistencyScore * 0.18 -
      volatilityPenalty * 0.10;

    // Concentration penalty: a token driven by one trader is not treated
    // like broad market participation.
    if (traders5 <= 1 && recent.length >= 5) score -= 15;
    if (traders5 === 2 && recent.length >= 8) score -= 7;

    score = Math.round(clamp(score));

    const action = score >= this.minScore ? "BUY_POSSIBLE" : "WAIT";

    return {
      mint: c.mint,
      symbol: c.symbol,
      name: c.name,
      score,
      action,
      observedAt: new Date().toISOString(),
      capitalEUR: this.capitalEUR,
      metrics: {
        trades5m: recent.length,
        trades1h: hour.length,
        volume5mUSD: round(volume5),
        volume10mUSD: round(volume10),
        volume15mUSD: round(volume15),
        buyRatio: round(buyRatio * 100),
        buys5m: buys,
        sells5m: sells,
        uniqueTraders5m: traders5,
        uniqueTraders1h: traders1h,
        priceChange5mPct: round(ret5),
        priceChange1hPct: ret1h === null ? null : round(ret1h),
        volumeAcceleration: acceleration === null ? null : round(acceleration)
      },
      scenario: scenarioEstimate(ret5, acceleration, buyRatio),
      warnings: [
        "Memecoin extrêmement spéculatif.",
        "Score non calibré en probabilité.",
        ...(traders5 < 3 ? ["Activité concentrée: prudence."] : []),
        ...(volatilityPenalty >= 20 ? ["Volatilité très élevée."] : [])
      ],
      dataQuality: "LIVE_TRADES_ONLY"
    };
  }

  noSignal(c, m) {
    return {
      mint: c.mint,
      symbol: c.symbol,
      name: c.name,
      score: null,
      action: "NO_SIGNAL",
      observedAt: new Date().toISOString(),
      capitalEUR: this.capitalEUR,
      reason: m.reason,
      metrics: {
        trades5m: m.recent.length,
        trades1h: m.hour.length,
        volume5mUSD: round(m.volume5),
        volume10mUSD: round(m.volume10),
        volume15mUSD: round(m.volume15),
        buyRatio: round(m.buyRatio * 100),
        buys5m: m.recent.filter(x => x.side === "BUY").length,
        sells5m: m.recent.filter(x => x.side === "SELL").length,
        uniqueTraders5m: m.traders5,
        uniqueTraders1h: m.traders1h,
        priceChange5mPct: round(m.ret5),
        priceChange1hPct: m.ret1h === null ? null : round(m.ret1h),
        volumeAcceleration: m.acceleration === null ? null : round(m.acceleration)
      },
      scenario: null,
      warnings: [
        "Pas assez de données pour produire un signal.",
        "Aucune probabilité n'est inventée."
      ],
      dataQuality: "INSUFFICIENT_DATA"
    };
  }

  status() {
    const now = Date.now();
    let activeTokens = 0;

    for (const c of this.map.values()) {
      if (c.last >= now - 5 * 60 * 1000) activeTokens++;
    }

    return {
      trackedTokens: this.map.size,
      activeTokens5m: activeTokens,
      totalTrades: this.totalTrades,
      lastIngest: this.lastIngest,
      minScore: this.minScore,
      capitalEUR: this.capitalEUR
    };
  }
}

function scenarioEstimate(ret5, accel, buyRatio) {
  if (!Number.isFinite(ret5) || !Number.isFinite(accel)) return null;

  const momentum =
    Math.max(0, ret5) *
    Math.min(2, Math.max(0.5, accel / 2)) *
    Math.max(0.7, buyRatio);

  const base = Math.max(10, Math.min(200, momentum * 2));

  return {
    favorablePct: round(base),
    strongPct: round(Math.min(500, base * 2)),
    extremePct: round(Math.min(1000, base * 4)),
    note: "Scénarios mécaniques non calibrés; ce ne sont pas des probabilités."
  };
}

function estimateVolatility(prices) {
  if (prices.length < 3) return 0;

  const returns = [];

  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(Math.abs(prices[i] / prices[i - 1] - 1) * 100);
    }
  }

  if (!returns.length) return 0;

  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  return Math.min(30, avg * 3);
}

function percentageChange(prices) {
  if (prices.length < 2 || prices[0] <= 0) return 0;
  return (prices.at(-1) / prices[0] - 1) * 100;
}

function scaleLog(x, min, max) {
  if (!Number.isFinite(x) || x <= 0) return 0;

  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const value = Math.log10(Math.max(x, min));

  return ((value - lo) / (hi - lo)) * 100;
}

function sum(items, fn) {
  return items.reduce((total, item) => total + (Number(fn(item)) || 0), 0);
}

function clamp(x) {
  return Math.max(0, Math.min(100, x));
}

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}
