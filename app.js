async function refresh() {
  try {
    const [st, rows] = await Promise.all([
      fetch("/api/status").then(r => r.json()),
      fetch("/api/candidates").then(r => r.json())
    ]);

    const stream = st.stream || {};
    const engine = st.engine || {};

    document.querySelector("#live").textContent =
      stream.connected && stream.subscribed ? "🟢 LIVE" : "🔴 OFFLINE";

    document.querySelector("#tracked").textContent =
      engine.trackedTokens ?? 0;

    document.querySelector("#active").textContent =
      engine.activeTokens5m ?? 0;

    document.querySelector("#trades").textContent =
      stream.trades ?? 0;

    document.querySelector("#lastTrade").textContent =
      stream.lastTrade
        ? new Date(stream.lastTrade).toLocaleTimeString()
        : "—";

    document.querySelector("#status").textContent =
      JSON.stringify(st, null, 2);

    const el = document.querySelector("#cards");

    if (!rows.length) {
      el.innerHTML = `
        <div class="card">
          <h2>🟡 Surveillance en cours</h2>
          <p class="muted">
            Aucun token n'a encore fourni assez de données pour être affiché.
          </p>
        </div>`;
      return;
    }

    el.innerHTML = rows.map(renderCard).join("");
  } catch (err) {
    document.querySelector("#live").textContent = "🔴 ERREUR";
    document.querySelector("#cards").innerHTML = `
      <div class="card">
        <h2>❌ Dashboard</h2>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function renderCard(x) {
  const noSignal = x.action === "NO_SIGNAL";
  const score = x.score === null ? "—" : `${x.score}/100`;

  const action = noSignal
    ? "🟡 NO SIGNAL"
    : x.action === "BUY_POSSIBLE"
      ? "🟢 ACHAT POSSIBLE"
      : "🟡 ATTENDRE";

  const actionClass = noSignal
    ? "yellow"
    : x.action === "BUY_POSSIBLE"
      ? "green"
      : "yellow";

  const scenario = x.scenario
    ? `
      <hr>
      <div class="muted">Scénario favorable: +${x.scenario.favorablePct}%</div>
      <div class="muted">Scénario fort: +${x.scenario.strongPct}%</div>
    `
    : "";

  return `
    <article class="card">
      <div class="muted">${escapeHtml(x.name || "")}</div>
      <h2>${escapeHtml(x.symbol || "?")}</h2>

      <div class="score">${score}</div>
      <p class="${actionClass}">${action}</p>

      ${x.reason ? `<p class="yellow">ℹ️ ${escapeHtml(x.reason)}</p>` : ""}

      <div class="metric">
        <span>Volume 5m</span>
        <b>$${x.metrics.volume5mUSD}</b>
      </div>

      <div class="metric">
        <span>Achats</span>
        <b>${x.metrics.buyRatio}%</b>
      </div>

      <div class="metric">
        <span>Trades 5m</span>
        <b>${x.metrics.trades5m}</b>
      </div>

      <div class="metric">
        <span>Traders 5m</span>
        <b>${x.metrics.uniqueTraders5m}</b>
      </div>

      <div class="metric">
        <span>Momentum 5m</span>
        <b>${x.metrics.priceChange5mPct}%</b>
      </div>

      <div class="metric">
        <span>Accélération</span>
        <b>${x.metrics.volumeAcceleration ?? "—"}x</b>
      </div>

      ${scenario}

      <p class="muted">${escapeHtml((x.warnings || []).join(" "))}</p>
      <small>${escapeHtml(x.mint)}</small>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refresh();
setInterval(refresh, 3000);
