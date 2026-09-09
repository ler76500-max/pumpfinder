async function refresh(){
 const [st,rows]=await Promise.all([
  fetch("/api/status").then(r=>r.json()),
  fetch("/api/candidates").then(r=>r.json())
 ]);
 document.querySelector("#live").textContent=st.stream.connected?"🟢 LIVE":"🔴 OFFLINE";
 document.querySelector("#status").textContent=JSON.stringify(st,null,2);
 const el=document.querySelector("#cards");
 el.innerHTML=rows.length?rows.map(x=>`
 <article class="card">
  <div class="muted">${x.name||""}</div>
  <h2>${x.symbol}</h2>
  <div class="score">${x.score}/100</div>
  <p class="${x.action==="BUY_POSSIBLE"?"green":"yellow"}">${x.action==="BUY_POSSIBLE"?"🟢 ACHAT POSSIBLE":"🟡 ATTENDRE"}</p>
  <div class="metric"><span>Volume 5m</span><b>$${x.metrics.volume5mUSD}</b></div>
  <div class="metric"><span>Achats</span><b>${x.metrics.buyRatio}%</b></div>
  <div class="metric"><span>Traders 5m</span><b>${x.metrics.uniqueTraders5m}</b></div>
  <div class="metric"><span>Momentum 5m</span><b>${x.metrics.priceChange5mPct}%</b></div>
  <div class="metric"><span>Accélération</span><b>${x.metrics.volumeAcceleration}x</b></div>
  <hr>
  <div class="muted">Scénario favorable: +${x.scenario.favorablePct}%</div>
  <div class="muted">Scénario fort: +${x.scenario.strongPct}%</div>
  <p class="muted">${x.warnings.join(" ")}</p>
  <small>${x.mint}</small>
 </article>`).join(""):`<div class="card">🛑 Aucun signal suffisamment documenté pour le moment.</div>`;
}
refresh();setInterval(refresh,3000);
