import WebSocket from "ws";

const PUMP = "pump";

const QUERY = `
subscription PumpTrades {
  Solana {
    DEXTrades(
      where: {
        Trade: {
          Dex: {
            ProtocolName: { is: "${PUMP}" }
          }
        }
        Transaction: {
          Result: { Success: true }
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
    this.wsUrl = wsUrl || "wss://streaming.bitquery.io/graphql";
    this.onTrade = onTrade;

    this.ws = null;
    this.connected = false;
    this.messages = 0;
    this.lastTrade = null;
    this.reconnectTimer = null;
  }

  start() {
    if (!this.token) {
      console.error("❌ BITQUERY_TOKEN manquant.");
      return;
    }

    this.connect();
  }

  connect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }

    console.log("🔌 Connexion Bitquery...");

    /*
     * Bitquery V2 accepte le token OAuth Bearer.
     * On utilise ici le header Authorization directement.
     */
    this.ws = new WebSocket(
      this.wsUrl,
      ["graphql-transport-ws"],
      {
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      }
    );

    this.ws.on("open", () => {
      console.log("✅ WebSocket Bitquery connecté");
      this.connected = true;

      this.ws.send(
        JSON.stringify({
          type: "connection_init",
          payload: {}
        })
      );
    });

    this.ws.on("message", raw => {
      try {
        const message = JSON.parse(raw.toString());

        /*
         * Bitquery confirme la connexion.
         */
        if (message.type === "connection_ack") {
          console.log("✅ Bitquery authentifié");
          this.subscribe();
          return;
        }

        /*
         * Keep-alive.
         */
        if (
          message.type === "ping" ||
          message.type === "ka"
        ) {
          try {
            this.ws.send(JSON.stringify({ type: "pong" }));
          } catch {}
          return;
        }

        /*
         * Erreur GraphQL.
         */
        if (message.type === "error") {
          console.error(
            "❌ Bitquery GraphQL:",
            JSON.stringify(message.payload)
          );
          return;
        }

        /*
         * Données.
         */
        if (
          message.type === "next" &&
          message.payload?.data
        ) {
          this.processData(message.payload.data);
          return;
        }

        /*
         * Compatibilité graphql-ws.
         */
        if (
          message.type === "data" &&
          message.payload?.data
        ) {
          this.processData(message.payload.data);
          return;
        }

      } catch (error) {
        console.error(
          "❌ Erreur message Bitquery:",
          error.message
        );
      }
    });

    this.ws.on("close", (code, reason) => {
      this.connected = false;

      console.error(
        `🔴 Bitquery déconnecté (${code}) ${reason || ""}`
      );

      this.scheduleReconnect();
    });

    this.ws.on("error", error => {
      console.error(
        "❌ Bitquery WebSocket:",
        error.message
      );
    });
  }

  subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    console.log("📡 Abonnement aux trades Pump.fun...");

    this.ws.send(
      JSON.stringify({
        id: "pump-trades",
        type: "subscribe",
        payload: {
          query: QUERY
        }
      })
    );
  }

  processData(data) {
    const rows =
      data?.Solana?.DEXTrades || [];

    for (const row of rows) {
      const trade = normalizeTrade(row);

      if (!trade) {
        continue;
      }

      this.messages++;
      this.lastTrade = new Date().toISOString();

      try {
        this.onTrade(trade);
      } catch (error) {
        console.error(
          "❌ Erreur traitement trade:",
          error.message
        );
      }
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      console.log("🔄 Reconnexion Bitquery...");
      this.connect();
    }, 5000);
  }

  status() {
    return {
      connected: this.connected,
      messages: this.messages,
      lastTrade: this.lastTrade,
      endpoint: this.wsUrl
    };
  }
}

function normalizeTrade(row) {
  const trade = row?.Trade;

  if (!trade) {
    return null;
  }

  const buy = trade.Buy;
  const sell = trade.Sell;

  /*
   * On cherche le token réellement échangé.
   */
  const buyMint =
    buy?.Currency?.MintAddress || null;

  const sellMint =
    sell?.Currency?.MintAddress || null;

  const buyIsToken =
    buyMint && !isNative(buyMint);

  const sellIsToken =
    sellMint && !isNative(sellMint);

  let tokenSide;

  if (buyIsToken) {
    tokenSide = buy;
  } else if (sellIsToken) {
    tokenSide = sell;
  } else {
    return null;
  }

  const mint =
    tokenSide?.Currency?.MintAddress;

  if (!mint) {
    return null;
  }

  const price = Number(
    tokenSide?.Price || 0
  );

  const usd = Number(
    tokenSide?.AmountInUSD ||
    buy?.AmountInUSD ||
    sell?.AmountInUSD ||
    0
  );

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(usd) ||
    usd <= 0
  ) {
    return null;
  }

  /*
   * Si le token apparaît côté Buy,
   * on considère l'opération comme un achat
   * du token.
   */
  const side =
    buyIsToken
      ? "BUY"
      : "SELL";

  const trader =
    buy?.Account?.Owner ||
    buy?.Account?.Address ||
    sell?.Account?.Owner ||
    sell?.Account?.Address ||
    null;

  return {
    mint,

    symbol:
      tokenSide?.Currency?.Symbol ||
      "UNKNOWN",

    name:
      tokenSide?.Currency?.Name ||
      "",

    time:
      row?.Block?.Time
        ? new Date(row.Block.Time).getTime()
        : Date.now(),

    signature:
      row?.Transaction?.Signature ||
      null,

    usd,
    price,
    side,
    trader,

    source: "bitquery_v2_pumpfun"
  };
}

function isNative(mint) {
  return (
    !mint ||
    mint ===
      "So11111111111111111111111111111111111111112" ||
    mint ===
      "11111111111111111111111111111111"
  );
}
