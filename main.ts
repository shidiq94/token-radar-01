// Token Launch Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json and writes, into
// MAKEFUN_OUTPUT_DIR (default /output):
//   board.json            the ranked board (200 rows)
//   dashboard/            index.html + app.css + app.js + data.js
//   screenshots/          the three dashboard screenshots
//   dossier.json          buildDossier(outDir, { text_max_bytes: 65536 })
//
// No network, no clock, no randomness: the same snapshot bytes always
// produce the same output bytes. Run twice and diff to prove it.
//
// Local run:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { selectBoard } from "./lib/model.ts";
import type { Snapshot, BoardRow } from "./lib/model.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function argValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function validateBoard(rows: BoardRow[], watchlist: string[]): void {
  if (rows.length < 100) {
    throw new Error(`board has ${rows.length} rows, need at least 100`);
  }
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.rank !== i + 1) throw new Error(`rank out of order at index ${i}`);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      throw new Error(`bad implied_value_usd for ${r.slug}`);
    }
    if (r.implied_value_usd > prev) {
      throw new Error(`board not sorted by implied value at ${r.slug}`);
    }
    prev = r.implied_value_usd;
    if (seen.has(r.slug)) throw new Error(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (!r.name) throw new Error(`empty name for ${r.slug}`);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      throw new Error(`farm_steps count ${r.farm_steps.length} for ${r.slug}`);
    }
    for (const step of r.farm_steps) {
      if (step.length < 20 || step.length > 600) {
        throw new Error(`farm step length ${step.length} for ${r.slug}`);
      }
    }
  }
  for (const slug of watchlist) {
    if (!seen.has(slug)) throw new Error(`watchlist slug missing from board: ${slug}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = argValue(argv, "--input") ?? "/input/snapshot.json";
  const outDir =
    argValue(argv, "--output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

  const snapshot = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new Error("snapshot is not shaped like {protocols, watchlist}");
  }
  const rows = selectBoard(snapshot);
  validateBoard(rows, snapshot.watchlist);

  const meta = {
    title: "Token Launch Radar",
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    rows: rows.length,
    watchlist_rows: rows.filter((r) => r.watchlist).length,
    model:
      "implied = tvl * peer_multiple (category median mcap/tvl, >=2 listed peers else global, clamped 0.02-2.0) * growth (1 + clamp(change_7d,-40,+100)/200) * tenure (1 + 0.03*min(years since listed_at,5))",
    note: "Protocols record no token (gecko_id and symbol null). Token-bearing protocols are excluded from ranking and used only as valuation comps.",
  };
  // data.js goes through the dashboard gate, which forbids URLs anywhere
  // in dashboard files — so its meta carries the plain source label,
  // not the snapshot's source string (which embeds the fetch URL).
  // board.json above keeps the full provenance string.
  const dataMeta = { ...meta, source: "DefiLlama" };

  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  // board.json
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify({ meta, rows }, null, 2) + "\n",
    "utf8",
  );

  // dashboard: copy the static page, then write its data.
  const dashSrc = join(ROOT, "dashboard");
  for (const file of ["index.html", "app.css", "app.js"]) {
    const src = join(dashSrc, file);
    if (!existsSync(src)) throw new Error(`missing dashboard file: ${src}`);
    cpSync(src, join(outDir, "dashboard", file));
  }
  const dataLines = [
    "window.BOARD = {",
    `  "meta": ${JSON.stringify(dataMeta)},`,
    '  "rows": [',
    ...rows.map((r, i) => "    " + JSON.stringify(r) + (i < rows.length - 1 ? "," : "")),
    "  ]",
    "};",
    "",
  ];
  writeFileSync(join(outDir, "dashboard", "data.js"), dataLines.join("\n"), "utf8");

  // screenshots: copy the three shots taken from the dashboard.
  const shotsSrc = join(ROOT, "screenshots");
  const shots = ["1-board.png", "2-detail.png", "3-filtered.png"];
  for (const shot of shots) {
    const src = join(shotsSrc, shot);
    if (!existsSync(src)) throw new Error(`missing screenshot: ${src}`);
    cpSync(src, join(outDir, "screenshots", shot));
  }

  // dossier.json last: it is built from the dashboard/ and screenshots/
  // files already written above, so it matches what the scorer computes.
  writeFileSync(join(outDir, "dossier.json"), buildDossier(outDir, { text_max_bytes: 65536 }));

  const total = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  console.log(`rows: ${rows.length} (watchlist ${meta.watchlist_rows})`);
  console.log(`top: ${rows[0].name} $${rows[0].implied_value_usd.toLocaleString("en-US")}`);
  console.log(`total implied value: $${total.toLocaleString("en-US")}`);
  console.log(`wrote ${outDir}`);
}

main();
