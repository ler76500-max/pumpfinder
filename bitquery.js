import WebSocket from "ws";

const WS_URL = "wss://pumpdev.io/ws";
const MAX_TOKEN_SUBSCRIPTIONS = Number(process.env.MAX_TOKEN_SUBSCRIPTIONS || 4);

export class PumpStream {
  constructor({ onTrade }) {
    this.onTrade = onTrade;
    this.ws = null;
    this.stopped = false;
    this.connected = false;
    this.newTokenSubscribed = false;
    this.tokenTradeSubscribed = false;
    this.tracked = new Map();
    this.totalTrades = 0;
    this.totalCreates = 0;
    this.lastTrade = null;
    this.lastCreate = null;
    this.lastError = null;
    this.reconnectTimer = null;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;

    console.log("🔌 Connexion PumpDev...");
    this.ws = new WebSocket(WS_URL);

    this.ws.on("open", () => {
      this.connected = true;
      this.lastError = null;
      console.log("🟢 PumpDev WebSocket connecté");

      this.send({ method: "subscribeNewToken" });
      this.newTokenSubscribed = true;
      console.log("📡 Abonnement nouveaux tokens actif");

      this.subscribeTrackedTokens();
    });

    this.ws.on("message", raw => {
      try {
        const event = JSON.parse(raw.toString());

        if (event.txType === "create") {
          this.totalCreates++;
          this.lastCreate = new Date().toISOString();

          if (event.mint) {
            this.trackToken(event);
          }

          console.log(
            `🆕 Nouveau token $${event.symbol || "?"} ${event.mint || ""}`
          );
          return;
        }

        if (event.txType === "buy" || event.txType === "sell") {
          const trade = normalizeTrade(event);
          if (!trade) return;

          this.totalTrades++;
          this.lastTrade = new Date().toISOString();

          const usdText =
            Number.isFinite(trade.usd) && trade.usd > 0
              ? `$${trade.usd.toFixed(2)}`
              : `${trade.quoteSOL.toFixed(4)} SOL`;

          console.log(
            `💰 ${trade.side} $${trade.symbol} | ${usdText}`
          );

          if (typeof this.onTrade === "function") {
            this.onTrade(trade);
          }
        }
      } catch (err) {
        this.lastError = err.message;
        console.error("❌ Erreur PumpDev:", err.message);
      }
    });

    this.ws.on("error", err => {
      this.lastError = err.message;
      console.error("❌ PumpDev WebSocket:", err.message);
    });

    this.ws.on("close", code => {
      this.connected = false;
      this.newTokenSubscribed = false;
      this.tokenTradeSubscribed = false;

      console.log(`🔴 PumpDev déconnecté (${code})`);

      if (!this.stopped) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    });
  }

  trackToken(event) {
    const mint = event.mint;
    if (!mint) return;

    if (this.tracked.has(mint)) return;

    if (this.tracked.size >= MAX_TOKEN_SUBSCRIPTIONS) {
      console.log(
        `⚠️ Limite gratuite atteinte: ${MAX_TOKEN_SUBSCRIPTIONS} tokens suivis`
      );
      return;
    }

    this.tracked.set(mint, {
      mint,
      symbol: event.symbol || "?",
      name: event.name || "",
      createdAt: Date.now()
    });

    // Each token trade subscription counts toward PumpDev's subscription limit.
    this.subscribeToken(mint);
  }

  subscribeTrackedTokens() {
    for (const mint of this.tracked.keys()) {
      this.subscribeToken(mint);
    }
  }

  subscribeToken(mint) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.send({
      method: "subscribeTokenTrade",
      keys: [mint]
    });

    this.tokenTradeSubscribed = true;
    console.log(
      `📡 Suivi trades: ${this.tracked.get(mint)?.symbol || "?"} (${this.tracked.size}/${MAX_TOKEN_SUBSCRIPTIONS})`
    );
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  status() {
    return {
      connected: this.connected,
      subscribed: this.newTokenSubscribed,
      tokenTradeSubscribed: this.tokenTradeSubscribed,
      trackedTokens: this.tracked.size,
      maxTrackedTokens: MAX_TOKEN_SUBSCRIPTIONS,
      trades: this.totalTrades,
      creates: this.totalCreates,
      lastTrade: this.lastTrade,
      lastCreate: this.lastCreate,
      lastError: this.lastError,
      dataSource: "PumpDev WebSocket (free)"
    };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

function normalizeTrade(event) {
  if (!event?.mint) return null;

  const usd = Number(
    event.usdAmount ??
    event.amountUsd ??
    event.tradeUsd ??
    0
  );

  const solAmount = Number(
    event.solAmount ??
    event.quoteAmount ??
    0
  );

  const amount = Number(
    event.tokenAmount ??
    event.amount ??
    0
  );

  const price = Number(
    event.price ??
    (amount > 0 && solAmount > 0 ? solAmount / amount : 0)
  );

  // PumpDev documents quoteAmount/solAmount for live trade events.
  // We keep the native quote amount instead of inventing a USD conversion.
  if (!Number.isFinite(solAmount) || solAmount <= 0) return null;

  const time = event.timestamp
    ? new Date(event.timestamp).getTime()
    : Date.now();

  const meta = this.metadata.get(event.mint) || {};
  return {
    mint: event.mint,
    symbol: event.symbol || meta.symbol || "?",
    name: event.name || meta.name || "",
    time: Number.isFinite(time) ? time : Date.now(),
    signature: event.signature || event.tx || "",
    usd: Number.isFinite(usd) && usd > 0 ? usd : null,
    quoteSOL: solAmount,
    price: Number.isFinite(price) && price > 0 ? price : 0,
    side: event.txType === "buy" ? "BUY" : "SELL",
    trader: event.traderPublicKey || event.user || event.owner || null
  };
}
