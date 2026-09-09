import WebSocket from "ws";

const PUMP = "pump";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const QUERY = `
subscription PumpTrades {
  Solana {
    DEXTrades(
      where: {
        Trade: { Dex: { ProtocolName: { is: "${PUMP}" } } }
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
  constructor({token,wsUrl,onTrade}) {
    this.token=token; this.wsUrl=wsUrl; this.onTrade=onTrade;
    this.ws=null; this.connected=false; this.messages=0; this.lastTrade=null;
  }

  start(){ if(!this.token) return; this.connect(); }

  connect(){
    const url = `${this.wsUrl}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url, ["graphql-transport-ws","graphql-ws"]);

    this.ws.on("open",()=>{
      this.connected=true;
      // graphql-transport-ws
      this.ws.send(JSON.stringify({type:"connection_init",payload:{}}));
    });

    this.ws.on("message",raw=>{
      try{
        const m=JSON.parse(raw.toString());
        if(m.type==="connection_ack" || m.type==="ka") {
          this.subscribe();
          return;
        }
        if(m.type==="next" && m.payload?.data) {
          this.messages++;
          const rows=m.payload.data?.Solana?.DEXTrades||[];
          for(const row of rows) {
            const t=normalize(row);
            if(t) {
              this.lastTrade=new Date().toISOString();
              this.onTrade(t);
            }
          }
        }
        // graphql-ws older message type
        if(m.type==="data" && m.payload?.data) {
          this.messages++;
          const rows=m.payload.data?.Solana?.DEXTrades||[];
          for(const row of rows) {
            const t=normalize(row);
            if(t) { this.lastTrade=new Date().toISOString(); this.onTrade(t); }
          }
        }
      }catch(e){console.error("Bitquery message:",e.message)}
    });

    this.ws.on("close",()=>{this.connected=false;setTimeout(()=>this.connect(),3000)});
    this.ws.on("error",e=>console.error("Bitquery WS:",e.message));
  }

  subscribe(){
    const payload={query:QUERY};
    // graphql-transport-ws
    this.ws.send(JSON.stringify({id:"pump-trades",type:"subscribe",payload}));
  }

  status(){
    return {connected:this.connected,messages:this.messages,lastTrade:this.lastTrade,pumpProgram:PUMP_PROGRAM};
  }
}

function normalize(row){
  const tr=row.Trade;
  const buy=tr?.Buy;
  const sell=tr?.Sell;
  // On Pump.fun, the traded token is the non-SOL currency. Use the side
  // that carries a non-native mint. Never guess a mint from a missing field.
  const candidate = buy?.Currency?.MintAddress && !isNative(buy.Currency.MintAddress)
    ? buy : sell?.Currency?.MintAddress && !isNative(sell.Currency.MintAddress) ? sell : null;
  if(!candidate?.Currency?.MintAddress) return null;

  const usd=Number(buy?.AmountInUSD ?? sell?.AmountInUSD ?? 0);
  const price=Number(buy?.Price ?? sell?.Price ?? 0);
  if(!Number.isFinite(usd) || usd<=0 || !Number.isFinite(price) || price<=0) return null;

  const side = buy?.Currency?.MintAddress === candidate.Currency.MintAddress ? "BUY" : "SELL";
  return {
    mint:candidate.Currency.MintAddress,
    symbol:candidate.Currency.Symbol || "?",
    name:candidate.Currency.Name || "",
    time:new Date(row.Block.Time).getTime(),
    signature:row.Transaction.Signature,
    usd, price, side,
    trader:(buy?.Account?.Owner || buy?.Account?.Address || sell?.Account?.Owner || sell?.Account?.Address || null)
  };
}

function isNative(mint){
  return !mint || mint==="So11111111111111111111111111111111111111112" || mint==="11111111111111111111111111111111";
}
