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
  minScore: Number(process.env.MIN_SCORE || 85)
});
const telegram = new Telegram();

const stream = new PumpStream({
  token: process.env.BITQUERY_TOKEN,
  wsUrl: process.env.BITQUERY_WS || "wss://streaming.bitquery.io/graphql",
  onTrade: trade => {
    engine.ingest(trade);
    const signal = engine.bestSignal();
    if (signal) {
      store.saveSignal(signal);
      telegram.maybeSend(signal);
    }
  }
});

app.get("/api/status", (_,res)=>res.json({
  ok:true,
  stream:stream.status(),
  candidates:engine.candidates().length,
  tokenConfigured:Boolean(process.env.BITQUERY_TOKEN)
}));

app.get("/api/candidates", (_,res)=>res.json(engine.candidates()));
app.get("/api/signals", (_,res)=>res.json(store.signals(100)));

app.get("/api/health", (_,res)=>res.json({
  noTrading:true,
  walletAccess:false,
  dataSource:"Bitquery V2 Pump.fun stream",
  timestamp:new Date().toISOString()
}));

const port = Number(process.env.PORT || 3000);
app.listen(port,()=>{
  console.log(`PumpFinder V3: http://localhost:${port}`);
  if (!process.env.BITQUERY_TOKEN) {
    console.log("BITQUERY_TOKEN absent: dashboard will run, but no live market data/signals.");
  } else {
    stream.start();
  }
});
