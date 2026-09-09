import WebSocket from "ws";

const PUMP_PROTOCOL = "pump";

const NATIVE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "11111111111111111111111111111111"
]);

const QUERY = `
subscription PumpTrades {
  Solana {
    DEXTrades(
      where: {
        Trade: {
          Dex: {
            ProtocolName: {
              is: "pump"
            }
          }
        }
      }
    ) {
      Block {
        Time
      }

      Transaction {
        Signature
      }

      Trade {
        Dex {
          ProtocolName
          ProtocolFamily
        }

        Buy {
          Amount
          AmountInUSD
          Price

          Currency {
            MintAddress
            Symbol
            Name
          }

          Account {
            Address
            Owner
          }
        }

        Sell {
          Amount
          AmountInUSD
          Price

          Currency {
            MintAddress
            Symbol
            Name
          }

          Account {
            Address
            Owner
          }
        }
      }
    }
  }
}
`;

export class PumpStream {
  constructor({ token, wsUrl, onTrade }) {
    this.token = token;
    this.wsUrl =
      wsUrl || "wss://streaming.bitquery.io/graphql";

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
    if (this.stopped || !this.token) {
      return;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }

    const base = this.wsUrl.replace(/\/$/, "");

    const separator = base.includes("?")
      ? "&"
      : "?";

    const url =
      `${base}${separator}token=` +
      encodeURIComponent(this.token);

    console.log("🔌 Connexion Bitquery...");

    this.connected = false;
    this.authenticated = false;
    this.subscribed = false;

    this.ws = new WebSocket(
      url,
      ["graphql-ws"]
    );

    this.ws.on("open", () => {
      this.connected = true;
      this.lastError = null;

      console.log(
        "🟢 WebSocket Bitquery connecté"
      );

      this.ws.send(
        JSON.stringify({
          type: "connection_init"
        })
      );
    });

    this.ws.on("message", raw => {
      try {
        const message =
          JSON.parse(raw.toString());

        this.messages++;

        console.log(
          `📨 Bitquery message: ${message.type}`
        );

        // =========================
        // AUTHENTIFICATION
        // =========================

        if (
          message.type ===
          "connection_ack"
        ) {
          this.authenticated = true;

          console.log(
            "✅ Bitquery authentifié"
          );

          this.subscribe();

          return;
        }

        // =========================
        // KEEP ALIVE
        // =========================

        if (
          message.type === "ka"
        ) {
          return;
        }

        // =========================
        // DONNÉES
        // =========================

        if (
          message.type === "data"
        ) {
          console.log(
            "📥 DONNÉES BITQUERY REÇUES"
          );

          const rows =
            message
              ?.payload
              ?.data
              ?.Solana
              ?.DEXTrades || [];

          console.log(
            `📊 Trades reçus: ${rows.length}`
          );

          this.handleRows(rows);

          return;
        }

        // =========================
        // ERREUR
        // =========================

        if (
          message.type === "error"
        ) {
          this.lastError =
            JSON.stringify(
              message.payload ||
              message
            );

          console.error(
            "❌ ERREUR BITQUERY:"
          );

          console.error(
            this.lastError
          );

          return;
        }

        // =========================
        // AUTRE FORMAT DE DONNÉES
        // =========================

        if (
          message.type === "next"
        ) {
          console.log(
            "📥 DONNÉES BITQUERY (NEXT)"
          );

          const rows =
            message
              ?.payload
              ?.data
              ?.Solana
              ?.DEXTrades || [];

          console.log(
            `📊 Trades reçus: ${rows.length}`
          );

          this.handleRows(rows);

          return;
        }

      } catch (err) {
        this.lastError =
          err.message;

        console.error(
          "❌ Erreur traitement Bitquery:",
          err.message
        );
      }
    });

    this.ws.on("error", err => {
      this.lastError =
        err.message;

      console.error(
        "❌ Bitquery WebSocket:",
        err.message
      );
    });

    this.ws.on("close", code => {
      this.connected = false;
      this.authenticated = false;
      this.subscribed = false;

      console.log(
        `🔴 Bitquery déconnecté (${code})`
      );

      if (!this.stopped) {
        console.log(
          "🔄 Reconnexion Bitquery..."
        );

        clearTimeout(
          this.reconnectTimer
        );

        this.reconnectTimer =
          setTimeout(
            () => this.connect(),
            3000
          );
      }
    });
  }

  subscribe() {
    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
    ) {
      console.error(
        "❌ Impossible de s'abonner: WebSocket fermé"
      );

      return;
    }

    console.log(
      "📡 Envoi abonnement Pump.fun..."
    );

    this.ws.send(
      JSON.stringify({
        id: "pump-trades",
        type: "start",
        payload: {
          query: QUERY
        }
      })
    );

    this.subscribed = true;

    console.log(
      "📡 Abonnement Pump.fun actif"
    );
  }

  handleRows(rows) {
    if (!Array.isArray(rows)) {
      return;
    }

    for (const row of rows) {
      const trade =
        normalize(row);

      if (!trade) {
        console.log(
          "⚠️ Trade ignoré: token impossible à identifier"
        );

        continue;
      }

      this.trades++;

      this.lastTrade =
        new Date().toISOString();

      console.log(
        `💰 ${trade.side} $${trade.symbol} | $${trade.usd.toFixed(2)}`
      );

      try {
        if (
          typeof this.onTrade ===
          "function"
        ) {
          this.onTrade(trade);
        } else {
          console.error(
            "❌ onTrade n'est pas une fonction"
          );
        }
      } catch (err) {
        console.error(
          "❌ Erreur moteur:",
          err.message
        );
      }
    }
  }

  status() {
    return {
      connected:
        this.connected,

      authenticated:
        this.authenticated,

      subscribed:
        this.subscribed,

      messages:
        this.messages,

      trades:
        this.trades,

      lastTrade:
        this.lastTrade,

      lastError:
        this.lastError
    };
  }

  stop() {
    this.stopped = true;

    clearTimeout(
      this.reconnectTimer
    );

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
  }
}


// =====================================
// NORMALISATION
// =====================================

function normalize(row) {
  const trade =
    row?.Trade;

  const buy =
    trade?.Buy;

  const sell =
    trade?.Sell;

  const buyMint =
    buy?.Currency?.MintAddress;

  const sellMint =
    sell?.Currency?.MintAddress;

  let candidate = null;
  let side = null;

  // Token acheté
  if (
    buyMint &&
    !isNative(buyMint)
  ) {
    candidate = buy;
    side = "BUY";
  }

  // Token vendu
  else if (
    sellMint &&
    !isNative(sellMint)
  ) {
    candidate = sell;
    side = "SELL";
  }

  // Impossible d'identifier
  if (!candidate) {
    return null;
  }

  const mint =
    candidate
      ?.Currency
      ?.MintAddress;

  if (
    !mint ||
    isNative(mint)
  ) {
    return null;
  }

  const usd =
    firstPositive(
      candidate?.AmountInUSD,
      buy?.AmountInUSD,
      sell?.AmountInUSD
    );

  const price =
    firstPositive(
      candidate?.Price,
      buy?.Price,
      sell?.Price
    );

  const time =
    new Date(
      row?.Block?.Time || 0
    ).getTime();

  if (
    !Number.isFinite(time) ||
    time <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(usd) ||
    usd <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  const trader =
    candidate?.Account?.Owner ||
    candidate?.Account?.Address ||
    null;

  return {
    mint,

    symbol:
      candidate
        ?.Currency
        ?.Symbol ||
      "UNKNOWN",

    name:
      candidate
        ?.Currency
        ?.Name ||
      "",

    time,

    signature:
      row
        ?.Transaction
        ?.Signature ||
      "",

    usd,

    price,

    side,

    trader
  };
}


// =====================================
// HELPERS
// =====================================

function firstPositive(...values) {
  for (const value of values) {
    const n =
      Number(value);

    if (
      Number.isFinite(n) &&
      n > 0
    ) {
      return n;
    }
  }

  return 0;
}

function isNative(mint) {
  return NATIVE_MINTS.has(mint);
}
