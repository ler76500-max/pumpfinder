import WebSocket from "ws";

const WS_URL = "wss://pumpdev.io/ws";
const MAX_TOKEN_SUBSCRIPTIONS = Number(process.env.MAX_TOKEN_SUBSCRIPTIONS || 4);

export class PumpStream {
  constructor({ onTrade }) {
    this.onTrade = onTrade;
    this.ws = null;
    this.tracked = new Set();
    this.metadata = new Map();
    this.stats = {
      creates: 0,
      trades: 0,
      errors: 0,
      connected: false
    };
  }

  start() {
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(WS_URL);

    this.ws.on("open", () => {
      this.stats.connected = true;
      console.log("🟢 PumpDev WebSocket connecté");

      this.send({ method: "subscribeNewToken" });
      console.log("📡 Abonnement nouveaux tokens actif");

      this.subscribeTrackedTokens();
    });

    this.ws.on("message", raw => {
      try {
        const event = JSON.parse(raw.toString());
        this.handleEvent(event);
      } catch (err) {
        this.stats.errors++;
        console.error("❌ Erreur PumpDev message:", err.message);
      }
    });

    this.ws.on("error", err => {
      this.stats.errors++;
      console.error("❌ Erreur PumpDev:", err.message);
    });

    this.ws.on("close", () => {
      this.stats.connected = false;
      console.log("🔴 PumpDev WebSocket fermé — reconnexion...");
      setTimeout(() => this.connect(), 3000);
    });
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  handleEvent(event) {
    if (!event || typeof event !== "object") return;

    if (event.txType === "create" || event.type === "create") {
      this.stats.creates++;

      if (event.mint) {
        this.metadata.set(event.mint, {
          symbol: event.symbol || "?",
          name: event.name || "",
          createdAt: event.timestamp || new Date().toISOString(),
          creator: event.creator || event.creatorPublicKey || null
        });
      }

      this.trackToken(event);

      const meta = this.metadata.get(event.mint);
      console.log(`🆕 Nouveau token $${meta?.symbol || event.symbol || "?"} ${event.mint}`);
      return;
    }

    if (event.txType === "buy" || event.txType === "sell") {
      const trade = this.normalizeTrade(event);
      if (!trade) return;

      this.stats.trades++;

      const valueText =
        Number.isFinite(trade.usd) && trade.usd > 0
          ? `$${trade.usd.toFixed(2)}`
          : `${trade.quoteSOL.toFixed(4)} SOL`;

      console.log(`💰 ${trade.side} $${trade.symbol} | ${valueText}`);

      if (typeof this.onTrade === "function") {
        this.onTrade(trade);
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
    console.log(`📡 Suivi trades: ${event.symbol || this.metadata.get(mint)?.symbol || "?"} (${this.tracked.size}/${MAX_TOKEN_SUBSCRIPTIONS})`);
    this.subscribeToken(mint);
  }

  subscribeTrackedTokens() {
    for (const mint of this.tracked) {
      this.subscribeToken(mint);
    }
  }

  subscribeToken(mint) {
    this.send({
      method: "subscribeTokenTrade",
      keys: [mint]
    });
  }

  normalizeTrade(event) {
    if (!event?.mint) return null;

    const meta = this.metadata.get(event.mint) || {};
    const usd = Number(event.usdAmount ?? event.amountUsd ?? event.tradeUsd ?? 0);
    const solAmount = Number(event.solAmount ?? event.quoteAmount ?? 0);
    const amount = Number(event.tokenAmount ?? event.amount ?? 0);

    const price = Number(
      event.price ??
      (amount > 0 && solAmount > 0 ? solAmount / amount : 0)
    );

    if (!Number.isFinite(solAmount) || solAmount <= 0) return null;

    const time = event.timestamp
      ? new Date(event.timestamp).getTime()
      : Date.now();

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
