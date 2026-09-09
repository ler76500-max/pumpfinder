import WebSocket from "ws";

export class PumpStream {
  constructor({ token, onTrade }) {
    this.token = token;
    this.onTrade = onTrade;
    this.ws = null;
    this.reconnectDelay = 3000;
    this.stopped = false;
  }

  start() {
    this.connect();
  }

  connect() {
    if (this.stopped) return;

    console.log("🔌 Connexion Bitquery...");

    if (!this.token) {
      console.error("❌ BITQUERY_TOKEN manquant");
      return;
    }

    const url =
      "wss://streaming.bitquery.io/graphql?token=" +
      encodeURIComponent(this.token);

    this.ws = new WebSocket(url, ["graphql-ws"]);

    this.ws.on("open", () => {
      console.log("🟢 WebSocket Bitquery connecté");

      this.ws.send(
        JSON.stringify({
          type: "connection_init"
        })
      );
    });

    this.ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        // Authentification réussie
        if (message.type === "connection_ack") {
          console.log("✅ Bitquery authentifié");

          const subscription = {
            id: "1",
            type: "start",
            payload: {
              query: `
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
              `
            }
          };

          this.ws.send(JSON.stringify(subscription));

          console.log("📡 Abonnement Pump.fun actif");
        }

        // ==============================
        // DONNÉES REÇUES DE BITQUERY
        // ==============================
        if (message.type === "data") {
          console.log("📥 DONNÉES BITQUERY REÇUES");

          const trades =
            message?.payload?.data?.Solana?.DEXTrades || [];

          console.log(`📊 Trades reçus: ${trades.length}`);

          for (const trade of trades) {
            this.handleTrade(trade);
          }
        }

        // ==============================
        // ERREUR BITQUERY
        // ==============================
        if (message.type === "error") {
          console.error(
            "❌ ERREUR BITQUERY:",
            JSON.stringify(message.payload)
          );
        }

        // Keep alive
        if (message.type === "ka") {
          return;
        }
      } catch (err) {
        console.error(
          "❌ Erreur traitement message Bitquery:",
          err.message
        );
      }
    });

    this.ws.on("error", (err) => {
      console.error(
        "❌ Bitquery WebSocket:",
        err.message
      );
    });

    this.ws.on("close", (code) => {
      console.log(`🔴 Bitquery déconnecté (${code})`);

      if (!this.stopped) {
        console.log("🔄 Reconnexion Bitquery...");

        setTimeout(() => {
          this.connect();
        }, this.reconnectDelay);
      }
    });
  }

  // ==============================
  // TRANSFORMATION DU TRADE
  // ==============================
  handleTrade(trade) {
    try {
      const buy = trade?.Trade?.Buy;
      const sell = trade?.Trade?.Sell;

      const currency =
        buy?.Currency || sell?.Currency;

      if (!currency?.MintAddress) {
        console.log("⚠️ Trade sans MintAddress");
        return;
      }

      const amountUSD =
        Number(buy?.AmountInUSD || 0) ||
        Number(sell?.AmountInUSD || 0);

      const price =
        Number(buy?.Price || 0) ||
        Number(sell?.Price || 0);

      const event = {
        mint: currency.MintAddress,

        symbol:
          currency.Symbol ||
          "UNKNOWN",

        name:
          currency.Name ||
          "",

        amountUSD,

        price,

        timestamp:
          trade?.Block?.Time ||
          new Date().toISOString(),

        signature:
          trade?.Transaction?.Signature ||
          "",

        side:
          buy
            ? "BUY"
            : "SELL"
      };

      console.log(
        `💰 ${event.side} ${event.symbol} | $${event.amountUSD}`
      );

      if (typeof this.onTrade === "function") {
        this.onTrade(event);
      } else {
        console.error("❌ onTrade n'est pas une fonction");
      }

    } catch (err) {
      console.error(
        "❌ Erreur normalisation trade:",
        err.message
      );
    }
  }

  stop() {
    this.stopped = true;

    if (this.ws) {
      this.ws.close();
    }
  }
}
