import "dotenv/config";
import express from "express";
import { PumpStream } from "./bitquery.js";
import { Engine } from "./engine.js";
import { Store } from "./store.js";
import { Telegram } from "./telegram.js";

const app = express();

app.use(express.json());
app.use(express.static("public"));

const store = new Store("./data/state.json");

const engine = new Engine({
  capitalEUR: Number(process.env.CAPITAL_EUR || 20),
  minScore: Number(process.env.MIN_SCORE || 85),
  maxCandidates: Number(process.env.MAX_CANDIDATES || 20)
});

const telegram = new Telegram();

const stream = new PumpStream({
    onTrade: trade => {
    engine.ingest(trade);

    const signal = engine.bestSignal();

    if (signal) {
      store.saveSignal(signal);
      telegram.maybeSend(signal);
    }
  }
});

app.get("/api/status", (_, res) => {
  res.json({
    ok: true,
    stream: stream.status(),
    engine: engine.status(),
    candidates: engine.candidates().length,
    dataSource: "PumpDev WebSocket (free)",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/candidates", (_, res) => {
  res.json(engine.candidates());
});

app.get("/api/signals", (_, res) => {
  res.json(store.signals(100));
});

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    noTrading: true,
    walletAccess: false,
    dataSource: "PumpDev WebSocket (free)",
    timestamp: new Date().toISOString()
  });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`PumpFinder FINAL: http://localhost:${port}`);

  stream.start();
});
