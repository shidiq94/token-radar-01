(function () {
  "use strict";

  var board = window.BOARD || { meta: {}, rows: [] };
  var rows = (board.rows || []).slice();
  var meta = board.meta || {};

  var state = {
    query: "",
    category: "all",
    chain: "all",
    watchlistOnly: false,
    sortKey: "rank",
    sortDir: 1
  };

  var searchInput = document.getElementById("searchInput");
  var categorySelect = document.getElementById("categorySelect");
  var chainSelect = document.getElementById("chainSelect");
  var watchlistOnly = document.getElementById("watchlistOnly");
  var sortSelect = document.getElementById("sortSelect");
  var tbody = document.getElementById("boardBody");
  var resultCount = document.getElementById("resultCount");
  var emptyState = document.getElementById("emptyState");
  var asOfEl = document.getElementById("asOf");
  var rowCountEl = document.getElementById("rowCount");
  var backdrop = document.getElementById("modalBackdrop");
  var detailContent = document.getElementById("detailContent");

  // ---------- formatting ----------

  function money(n) {
    if (n == null || isNaN(n)) return "\u2014";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function pct(n) {
    if (n == null || isNaN(n)) return "\u2014";
    var sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "%";
  }

  function mult(n) {
    if (n == null || isNaN(n)) return "\u2014";
    return n.toFixed(3) + "x";
  }

  function factor(n) {
    if (n == null || isNaN(n)) return "\u2014";
    return n.toFixed(2) + "x";
  }

  function dash(v) {
    return v == null || v === "" ? "\u2014" : v;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pctClass(n) {
    if (n == null) return "muted";
    return n > 0 ? "pos" : (n < 0 ? "neg" : "muted");
  }

  // ---------- filter option lists ----------

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      if (v != null && v !== "" && !seen[v]) { seen[v] = true; out.push(v); }
    });
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  function buildSelect(select, items, allLabel) {
    select.innerHTML = "";
    var all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    select.appendChild(all);
    items.forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item;
      opt.textContent = item;
      select.appendChild(opt);
    });
  }

  var categories = uniqueSorted(rows.map(function (r) { return r.category; }));
  var chains = uniqueSorted(rows.reduce(function (acc, r) {
    return acc.concat(r.chains || []);
  }, []));
  buildSelect(categorySelect, categories, "All categories");
  buildSelect(chainSelect, chains, "All chains");

  // ---------- filtering & sorting ----------

  function filteredRows() {
    var q = state.query.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== "all" && r.category !== state.category) return false;
      if (state.chain !== "all" && !(r.chains || []).indexOf(state.chain) >= 0) return false;
      if (q) {
        var hay = ((r.name || "") + " " + (r.slug || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function sortValue(r, key) {
    var v = r[key];
    if (v == null) return key === "name" || key === "category" ? "" : -Infinity;
    return v;
  }

  function sortRows(list) {
    var key = state.sortKey;
    var dir = state.sortDir;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (typeof av === "string") {
        return dir * av.localeCompare(bv);
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return (a.rank - b.rank) * 1;
    });
  }

  // ---------- rendering ----------

  function render() {
    var list = sortRows(filteredRows());

    resultCount.textContent = "Showing " + list.length + " of " + rows.length + " protocols";
    emptyState.hidden = list.length !== 0;

    var html = "";
    list.forEach(function (r) {
      var badge = r.watchlist ? '<span class="watch-badge">Watchlist</span>' : "";
      html += '<tr data-slug="' + esc(r.slug) + '">'
        + '<td class="rank num">' + r.rank + "</td>"
        + '<td><span class="proto-name">' + esc(r.name) + "</span>" + badge
        + '<div class="proto-slug">' + esc(r.slug) + "</div></td>"
        + "<td>" + esc(dash(r.category)) + "</td>"
        + '<td class="chain-list">' + esc((r.chains || []).join(", ")) + "</td>"
        + '<td class="num">' + money(r.tvl_usd) + "</td>"
        + '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + "</td>"
        + '<td class="num implied">' + money(r.implied_value_usd) + "</td>"
        + "</tr>";
    });
    tbody.innerHTML = html;

    var ths = document.querySelectorAll("thead th[data-sort]");
    ths.forEach(function (th) {
      var key = th.getAttribute("data-sort");
      th.classList.toggle("sorted", key === state.sortKey);
      th.classList.toggle("desc", key === state.sortKey && state.sortDir === -1);
    });
  }

  // ---------- detail view ----------

  function yearsText(r) {
    if (r.years_no_token == null || isNaN(r.years_no_token)) return "\u2014";
    var y = r.years_no_token;
    var years = Math.floor(y);
    var months = Math.round((y - years) * 12);
    if (months === 12) { years += 1; months = 0; }
    if (years === 0) return months + (months === 1 ? " month" : " months");
    var s = years + (years === 1 ? " year" : " years");
    if (months > 0) s += " " + months + (months === 1 ? " month" : " months");
    return s;
  }

  function openDetail(slug) {
    var r = null;
    rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) return;

    var badge = r.watchlist ? ' <span class="watch-badge">Watchlist</span>' : "";
    var steps = (r.farm_steps || []).map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");

    detailContent.innerHTML =
      '<h2 class="detail-title" id="detailName">' + esc(r.name) + badge + "</h2>"
      + '<p class="detail-sub">' + esc(r.slug) + " &middot; Rank #" + r.rank + "</p>"
      + '<div class="detail-grid">'
      + '<div><div class="label">Category</div><div class="value dim">' + esc(dash(r.category)) + "</div></div>"
      + '<div><div class="label">Chains</div><div class="value dim">' + esc((r.chains || []).join(", ")) + "</div></div>"
      + '<div><div class="label">TVL</div><div class="value">' + money(r.tvl_usd) + "</div></div>"
      + '<div><div class="label">7d change</div><div class="value ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + "</div></div>"
      + '<div><div class="label">Listed</div><div class="value dim">' + esc(dash(r.listed_at)) + "</div></div>"
      + '<div><div class="label">Years with no token</div><div class="value">' + esc(yearsText(r)) + "</div></div>"
      + "</div>"
      + '<div class="detail-section"><h3>Implied value model</h3><div class="model-box">'
      + '<div class="model-line"><span>TVL</span><span>' + money(r.tvl_usd) + "</span></div>"
      + '<div class="model-line"><span>Peer multiple</span><span>' + mult(r.multiple) + "</span></div>"
      + '<div class="model-line"><span>Growth factor</span><span>' + factor(r.growth_factor) + "</span></div>"
      + '<div class="model-line"><span>Tenure factor</span><span>' + factor(r.tenure_factor) + "</span></div>"
      + '<div class="model-line model-total"><span>Implied value</span><span>' + money(r.implied_value_usd) + "</span></div>"
      + "</div></div>"
      + '<div class="detail-section"><h3>Farm steps</h3><ol class="farm-steps">' + steps + "</ol></div>"
      + '<p class="detail-sub">This protocol records no token. Implied value is an estimate, not a prediction, and no launch is promised.</p>';

    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    backdrop.hidden = true;
    document.body.style.overflow = "";
  }

  // ---------- events ----------

  searchInput.addEventListener("input", function () {
    state.query = searchInput.value;
    render();
  });

  categorySelect.addEventListener("change", function () {
    state.category = categorySelect.value;
    render();
  });

  chainSelect.addEventListener("change", function () {
    state.chain = chainSelect.value;
    render();
  });

  watchlistOnly.addEventListener("change", function () {
    state.watchlistOnly = watchlistOnly.checked;
    render();
  });

  sortSelect.addEventListener("change", function () {
    state.sortKey = sortSelect.value;
    state.sortDir = 1;
    render();
  });

  document.querySelectorAll("thead th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (key === "chains") {
        // Chains are a list, not a sortable scalar; fall back to rank.
        state.sortKey = "rank";
        state.sortDir = 1;
        sortSelect.value = "rank";
        render();
        return;
      }
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === "name" || key === "category" ? 1 : -1;
        if (key === "rank") state.sortDir = 1;
      }
      sortSelect.value = ["rank", "implied_value_usd", "tvl_usd", "change_7d"].indexOf(state.sortKey) >= 0
        ? state.sortKey
        : "rank";
      render();
    });
  });

  tbody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (tr) openDetail(tr.getAttribute("data-slug"));
  });

  document.getElementById("modalClose").addEventListener("click", closeDetail);
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeDetail();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !backdrop.hidden) closeDetail();
  });

  // ---------- init ----------

  asOfEl.textContent = meta.as_of || "\u2014";
  rowCountEl.textContent = rows.length + " protocols";

  // URL query params: ?row=<slug>, ?watchlist=1, ?category=<name>
  var params = new URLSearchParams(window.location.search);
  var paramCategory = params.get("category");
  if (paramCategory && categories.indexOf(paramCategory) >= 0) {
    state.category = paramCategory;
    categorySelect.value = paramCategory;
  }
  if (params.get("watchlist") === "1") {
    state.watchlistOnly = true;
    watchlistOnly.checked = true;
  }

  render();

  var paramRow = params.get("row");
  if (paramRow) openDetail(paramRow);
})();
