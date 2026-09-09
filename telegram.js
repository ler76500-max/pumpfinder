export class Telegram {
  constructor(){this.token=process.env.TELEGRAM_BOT_TOKEN;this.chat=process.env.TELEGRAM_CHAT_ID;this.cooldown=+(process.env.ALERT_COOLDOWN_SEC||300)*1000;this.last=new Map()}
  async maybeSend(s){
    if(!this.token||!this.chat)return;
    const now=Date.now(), prev=this.last.get(s.mint)||0;
    if(now-prev<this.cooldown)return;
    this.last.set(s.mint,now);
    const m=s.metrics;
    const text=[
      "🚨 PUMPFINDER — SIGNAL",
      "",
      `🪙 ${s.symbol}`,
      `⭐ Score: ${s.score}/100`,
      `💵 Mise étudiée: ${s.capitalEUR} €`,
      "",
      `📈 5m: ${m.priceChange5mPct}%`,
      `💰 Volume 5m: $${m.volume5mUSD}`,
      `🟢 Achats: ${m.buyRatio}%`,
      `👥 Traders 5m: ${m.uniqueTraders5m}`,
      `⚡ Accélération: ${m.volumeAcceleration}x`,
      "",
      `🎯 Scénario favorable: +${s.scenario.favorablePct}%`,
      `🚀 Scénario fort: +${s.scenario.strongPct}%`,
      "",
      "🟢 ACTION: ACHAT POSSIBLE",
      "",
      "⚠️ Score de configuration non calibré en probabilité. Fais ta propre vérification avant d'acheter."
    ].join("\\n");
    await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:this.chat,text})
    }).catch(e=>console.error("telegram",e.message));
  }
}
