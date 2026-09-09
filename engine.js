const HOUR=60*60*1000;

export class Engine {
  constructor({capitalEUR,minScore}) {
    this.capitalEUR=capitalEUR;
    this.minScore=minScore;
    this.map=new Map();
  }

  ingest(t) {
    let c=this.map.get(t.mint);
    if(!c) {
      c={mint:t.mint,symbol:t.symbol,name:t.name,trades:[],last:t.time,first:t.time};
      this.map.set(t.mint,c);
    }
    c.symbol=t.symbol||c.symbol;
    c.name=t.name||c.name;
    c.trades.push(t);
    c.trades=c.trades.filter(x=>x.time>=Date.now()-HOUR);
    c.last=t.time;
  }

  candidates() {
    const out=[];
    for(const c of this.map.values()) {
      const s=this.score(c);
      if(s) out.push(s);
    }
    return out.sort((a,b)=>b.score-a.score).slice(0,20);
  }

  bestSignal() {
    const top=this.candidates()[0];
    if(!top || top.score<this.minScore) return null;
    return top;
  }

  score(c) {
    const now=Date.now();
    const recent=c.trades.filter(x=>x.time>=now-5*60*1000);
    const older=c.trades.filter(x=>x.time>=now-15*60*1000 && x.time<now-5*60*1000);
    const hour=c.trades;

    if(recent.length<5 || hour.length<12) return null;

    const volume5=recent.reduce((a,x)=>a+x.usd,0);
    const volume10=hour.filter(x=>x.time>=now-10*60*1000).reduce((a,x)=>a+x.usd,0);
    const volume15=hour.filter(x=>x.time>=now-15*60*1000).reduce((a,x)=>a+x.usd,0);
    const oldVol=older.reduce((a,x)=>a+x.usd,0);

    const buys=recent.filter(x=>x.side==="BUY").length;
    const sells=recent.filter(x=>x.side==="SELL").length;
    const buyRatio=recent.length ? buys/recent.length : 0;

    const traders=new Set(recent.map(x=>x.trader).filter(Boolean)).size;
    const uniqueHour=new Set(hour.map(x=>x.trader).filter(Boolean)).size;

    const prices=hour.map(x=>x.price).filter(Number.isFinite);
    const last=prices.at(-1);
    const first=prices[0];
    const ret1h=first>0 ? (last/first-1)*100 : null;

    const recentPrices=recent.map(x=>x.price).filter(Number.isFinite);
    const ret5=recentPrices.length>1 && recentPrices[0]>0 ? (recentPrices.at(-1)/recentPrices[0]-1)*100 : 0;

    const acceleration=oldVol>0 ? volume5/(oldVol/2) : 0;

    // Conservative score: it rewards real activity and buying pressure,
    // but explicitly penalizes one-wallet / one-trader activity.
    const activityScore=clamp(scaleLog(volume5,100,50000));
    const pressureScore=clamp(buyRatio*100);
    const accelScore=clamp(scaleLog(acceleration,0.5,8));
    const diversityScore=clamp((traders/Math.max(recent.length,1))*130);
    const consistencyScore=clamp(50 + ret5*1.5);
    const volatilityPenalty=estimateVolatility(recentPrices);

    let score =
      activityScore*.22 +
      pressureScore*.24 +
      accelScore*.18 +
      diversityScore*.18 +
      consistencyScore*.18 -
      volatilityPenalty*.10;

    score=Math.round(clamp(score));

    // No "probability" is fabricated. The output is a ranking score.
    const scenario = scenarioEstimate(ret5, acceleration, buyRatio);
    return {
      mint:c.mint,
      symbol:c.symbol,
      name:c.name,
      score,
      action:score>=this.minScore?"BUY_POSSIBLE":"WAIT",
      observedAt:new Date().toISOString(),
      capitalEUR:this.capitalEUR,
      metrics:{
        trades5m:recent.length,
        trades1h:hour.length,
        volume5mUSD:round(volume5),
        volume10mUSD:round(volume10),
        volume15mUSD:round(volume15),
        buyRatio:round(buyRatio*100),
        uniqueTraders5m:traders,
        uniqueTraders1h:uniqueHour,
        priceChange5mPct:round(ret5),
        priceChange1hPct:ret1h===null?null:round(ret1h),
        volumeAcceleration:round(acceleration)
      },
      scenario,
      warnings:[
        "Memecoin extrêmement spéculatif.",
        "Score non calibré en probabilité.",
        ...(traders<3?["Activité concentrée: prudence."]:[])
      ],
      dataQuality:"LIVE_TRADES_ONLY"
    };
  }
}

function scenarioEstimate(ret5,accel,buyRatio){
  // These are scenario levels, not promises or probabilities.
  const momentum=Math.max(0,ret5)*Math.min(2,Math.max(0.5,accel/2))*Math.max(.7,buyRatio);
  const base=Math.max(10,Math.min(200,momentum*2));
  return {
    favorablePct:round(base),
    strongPct:round(Math.min(500,base*2)),
    extremePct:round(Math.min(1000,base*4)),
    note:"Scénarios mécaniques non calibrés; ne pas les interpréter comme probabilités."
  };
}

function estimateVolatility(p){
  if(p.length<3)return 0;
  const r=[];
  for(let i=1;i<p.length;i++) if(p[i-1]>0) r.push(Math.abs(p[i]/p[i-1]-1)*100);
  const v=r.reduce((a,b)=>a+b,0)/r.length;
  return Math.min(30,v*3);
}
function scaleLog(x,min,max){
  if(!Number.isFinite(x)||x<=0)return 0;
  const a=Math.log10(Math.max(x,min)),b=Math.log10(max);
  const lo=Math.log10(min);
  return ((a-lo)/(b-lo))*100;
}
function clamp(x){return Math.max(0,Math.min(100,x))}
function round(x){return Math.round(x*100)/100}
