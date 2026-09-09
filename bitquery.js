import WebSocket from "ws";

const WS_URL = "wss://pumpdev.io/ws";
const MAX_TOKEN_SUBSCRIPTIONS = Number(process.env.MAX_TOKEN_SUBSCRIPTIONS || 4);

export class PumpStream {
  constructor({ onTrade } = {}) {
    this.onTrade = typeof onTrade === "function" ? onTrade : () => {};
    this.ws = null;
    this.tracked = new Set();
    this.metadata = new Map();
    this.stats = { creates: 0, trades: 0, errors: 0, connected: false };
    this.reconnectTimer = null;
  }

  start() { this.connect(); }

  connect() {
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      this.fail(err);
      return;
    }

    this.ws.on("open", () => {
      this.stats.connected = true;
      console.log("🟢 PumpDev WebSocket connecté");
      this.send({ method: "subscribeNewToken" });
      console.log("📡 Abonnement nouveaux tokens actif");
      for (const mint of this.tracked) this.subscribeToken(mint);
    });

    this.ws.on("message", raw => {
      try {
        const event = JSON.parse(raw.toString());
        this.handleEvent(event);
      } catch (err) {
        this.fail(err, "message");
      }
    });

    this.ws.on("error", err => this.fail(err));

    this.ws.on("close", () => {
      this.stats.connected = false;
      if (!this.reconnectTimer) {
        console.log("🔴 PumpDev WebSocket fermé — reconnexion...");
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 3000);
      }
    });
  }

  fail(err, where = "") {
    this.stats.errors++;
    const prefix = where ? `❌ Erreur PumpDev ${where}:` : "❌ Erreur PumpDev:";
    console.error(prefix, err?.message || err);
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  handleEvent(event) {
    if (!event || typeof event !== "object") return;

    const type = event.txType || event.type;

    if (type === "create") {
      this.stats.creates++;

      if (event.mint) {
        this.metadata.set(event.mint, {
          symbol: event.symbol || "?",
          name: event.name || "",
          createdAt: event.timestamp || new Date().toISOString()
        });
      }

      this.trackToken(event);
      const meta = this.metadata.get(event.mint);
      console.log(`🆕 Nouveau token $${meta?.symbol || "?"} ${event.mint || ""}`);
      return;
    }

    if (type === "buy" || type === "sell") {
      const trade = this.normalizeTrade(event);
      if (!trade) return;

      this.stats.trades++;

      const value = trade.usd > 0
        ? `$${trade.usd.toFixed(2)}`
        : `${trade.quoteSOL.toFixed(4)} SOL`;

      console.log(`💰 ${trade.side} $${trade.symbol} | ${value}`);

      try {
        this.onTrade(trade);
      } catch (err) {
        this.fail(err, "moteur");
      }
    }
  }

  trackToken(event) {
    const mint = event?.mint;
    if (!mint || this.tracked.has(mint)) return;

    if (this.tracked.size >= MAX_TOKEN_SUBSCRIPTIONS) {
      console.log(`⚠️ Limite gratuite atteinte: ${MAX_TOKEN_SUBSCRIPTIONS} tokens suivis`);
      return;
    }

    this.tracked.add(mint);
    const symbol = event.symbol || this.metadata.get(mint)?.symbol || "?";
    console.log(`📡 Suivi trades: ${symbol} (${this.tracked.size}/${MAX_TOKEN_SUBSCRIPTIONS})`);
    this.subscribeToken(mint);
  }

  subscribeToken(mint) {
    this.send({ method: "subscribeTokenTrade", keys: [mint] });
  }

  normalizeTrade(event) {
    if (!event?.mint) return null;

    const meta = this.metadata.get(event.mint) || {};
    const solAmount = Number(event.solAmount ?? event.quoteAmount ?? 0);
    const usd = Number(event.usdAmount ?? event.amountUsd ?? event.tradeUsd ?? 0);
    const tokenAmount = Number(event.tokenAmount ?? event.amount ?? 0);
    const calculatedPrice = tokenAmount > 0 && solAmount > 0
      ? solAmount / tokenAmount
      : 0;
    const price = Number(event.price ?? calculatedPrice);

    if (!Number.isFinite(solAmount) || solAmount <= 0) return null;

    const timestamp = event.timestamp
      ? new Date(event.timestamp).getTime()
      : Date.now();

    return {
      mint: event.mint,
      symbol: event.symbol || meta.symbol || "?",
      name: event.name || meta.name || "",
      time: Number.isFinite(timestamp) ? timestamp : Date.now(),
      signature: event.signature || event.tx || "",
      usd: Number.isFinite(usd) && usd > 0 ? usd : 0,
      quoteSOL: solAmount,
      price: Number.isFinite(price) && price > 0 ? price : 0,
      side: event.txType === "buy" ? "BUY" : "SELL",
      trader: event.traderPublicKey || event.user || event.owner || null
    };
  }

  status() {
    return {
      connected: this.stats.connected,
      creates: this.stats.creates,
      trades: this.stats.trades,
      errors: this.stats.errors,
      trackedTokens: this.tracked.size,
      maxTrackedTokens: MAX_TOKEN_SUBSCRIPTIONS,
      metadataCached: this.metadata.size
    };
  }
}
