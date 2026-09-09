import WebSocket from "ws";

const PUMP_PROTOCOL = "pump";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const NATIVE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "11111111111111111111111111111111"
]);

const QUERY = `
subscription PumpTrades {
  Solana {
    DEXTrades(
      where: {
        Trade: { Dex: { ProtocolName: { is: "${PUMP_PROTOCOL}" } } }
        Transaction: { Result: { Success: true } }
      }
    ) {
      Block { Time }
      Transaction { Signature }
      Trade {
        Dex { ProtocolName ProtocolFamily }
        Buy {
          Amount
          AmountInUSD
          Price
          Currency { MintAddress Symbol Name }
          Account { Address Owner }
        }
        Sell {
          Amount
          AmountInUSD
          Price
          Currency { MintAddress Symbol Name }
          Account { Address Owner }
        }
      }
    }
  }
}`;

export class PumpStream {
  constructor({ token, wsUrl, onTrade }) {
    this.token = token;
    this.wsUrl = wsUrl || "wss://streaming.bitquery.io/graphql";
    this.onTrade = onTrade;
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.subscribed = false;
    this.messages = 0;
    this.trades = 0;
    this.lastTrade = null;
    this.lastError = null;
    this.reconnectTimer = null;
    this.stopped = false;
  }

  start() {
    if (!this.token) {
      this.lastError = "BITQUERY_TOKEN manquant";
      console.error("❌ BITQUERY_TOKEN manquant");
      return;
    }
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped || !this.token) return;

    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    const base = this.wsUrl.replace(/\/$/, "");
    const separator = base.includes("?") ? "&" : "?";
    const url = `${base}${separator}token=${encodeURIComponent(this.token)}`;

    console.log("🔌 Connexion Bitquery...");

    this.connected = false;
    this.authenticated = false;
    this.subscribed = false;

    // Bitquery documents graphql-ws with ?token=... for this JS client.
    this.ws = new WebSocket(url, ["graphql-ws"]);

    this.ws.on("open", () => {
      this.connected = true;
      this.lastError = null;
      console.log("🟢 WebSocket Bitquery connecté");
      this.ws.send(JSON.stringify({ type: "connection_init" }));
    });

    this.ws.on("message", raw => {
      try {
        const message = JSON.parse(raw.toString());

        if (message.type === "connection_ack") {
          this.authenticated = true;
          console.log("✅ Bitquery authentifié");
          this.subscribe();
          return;
        }

        if (message.type === "ka") return;

        if (message.type === "data") {
          this.handleRows(message.payload?.data?.Solana?.DEXTrades || []);
          return;
        }

        if (message.type === "error") {
          this.lastError = JSON.stringify(message.payload || message);
          console.error("❌ ERREUR BITQUERY:", this.lastError);
          return;
        }

        // Some gateways may return a complete/next envelope.
        if (message.type === "next") {
          this.handleRows(message.payload?.data?.Solana?.DEXTrades || []);
        }
      } catch (err) {
        this.lastError = err.message;
        console.error("❌ Erreur traitement Bitquery:", err.message);
      }
    });

    this.ws.on("error", err => {
      this.lastError = err.message;
      console.error("❌ Bitquery WebSocket:", err.message);
    });

    this.ws.on("close", code => {
      this.connected = false;
      this.authenticated = false;
      this.subscribed = false;
      console.log(`🔴 Bitquery déconnecté (${code})`);

      if (!this.stopped) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    });
  }

  subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      id: "pump-trades",
      type: "start",
      payload: { query: QUERY }
    }));

    this.subscribed = true;
    console.log("📡 Abonnement Pump.fun actif");
  }

  handleRows(rows) {
    this.messages++;

    if (!rows.length) return;

    for (const row of rows) {
      const trade = normalize(row);
      if (!trade) continue;

      this.trades++;
      this.lastTrade = new Date().toISOString();

      try {
        this.onTrade(trade);
      } catch (err) {
        console.error("❌ Erreur onTrade:", err.message);
      }
    }
  }

  status() {
    return {
      connected: this.connected,
      authenticated: this.authenticated,
      subscribed: this.subscribed,
      messages: this.messages,
      trades: this.trades,
      lastTrade: this.lastTrade,
      lastError: this.lastError,
      pumpProgram: PUMP_PROGRAM
    };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

function normalize(row) {
  const trade = row?.Trade;
  const buy = trade?.Buy;
  const sell = trade?.Sell;

  // The candidate token is the non-native currency in the pair.
  const buyMint = buy?.Currency?.MintAddress;
  const sellMint = sell?.Currency?.MintAddress;

  let candidate;
  let side;

  if (buyMint && !isNative(buyMint)) {
    candidate = buy;
    side = "BUY";
  } else if (sellMint && !isNative(sellMint)) {
    candidate = sell;
    side = "SELL";
  } else {
    // No identifiable Pump.fun token: do not guess.
    return null;
  }

  const mint = candidate?.Currency?.MintAddress;
  if (!mint || isNative(mint)) return null;

  const usd = firstPositive(
    buy?.AmountInUSD,
    sell?.AmountInUSD
  );

  const price = firstPositive(
    candidate?.Price,
    buy?.Price,
    sell?.Price
  );

  const time = new Date(row?.Block?.Time || 0).getTime();

  if (!Number.isFinite(time) || time <= 0) return null;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;

  const trader =
    candidate?.Account?.Owner ||
    candidate?.Account?.Address ||
    buy?.Account?.Owner ||
    buy?.Account?.Address ||
    sell?.Account?.Owner ||
    sell?.Account?.Address ||
    null;

  return {
    mint,
    symbol: candidate?.Currency?.Symbol || "?",
    name: candidate?.Currency?.Name || "",
    time,
    signature: row?.Transaction?.Signature || "",
    usd,
    price,
    side,
    trader
  };
}

function firstPositive(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function isNative(mint) {
  return NATIVE_MINTS.has(mint);
}
