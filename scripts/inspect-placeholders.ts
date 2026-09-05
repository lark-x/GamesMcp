import fs from "node:fs";
import { loadConfig } from "../packages/config/src/index.ts";
import { createPool } from "../packages/database/src/index.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

async function inspectTags() {
  console.log("--- Inspecting all tables for placeholders ---");

  // 1. quest_dialogue_nodes
  const nodes = await pool.query(`
    SELECT body FROM knowledge.quest_dialogue_nodes
    WHERE body LIKE '%{%}%'
  `);
  console.log("Found dialogue node rows with placeholders:", nodes.rowCount);

  // 2. documents
  const docs = await pool.query(`
    SELECT title, body FROM knowledge.documents
    WHERE body LIKE '%{%}%' OR title LIKE '%{%}%'
  `);
  console.log("Found document rows with placeholders:", docs.rowCount);

  // 3. quest_subquests
  const subquests = await pool.query(`
    SELECT title, objective FROM knowledge.quest_subquests
    WHERE title LIKE '%{%}%' OR objective LIKE '%{%}%'
  `);
  console.log("Found subquest rows with placeholders:", subquests.rowCount);

  const rawTags = new Map<string, number>();
  const patternCategories = new Map<
    string,
    { count: number; examples: Set<string>; rawTags: Set<string> }
  >();

  function record(text: string | null | undefined) {
    if (!text) return;
    const matches = text.match(/\{[^}]+\}/g);
    if (!matches) return;
    for (const m of matches) {
      rawTags.set(m, (rawTags.get(m) || 0) + 1);

      let cat = "OTHER";
      if (/^\{NICKNAME\}$/i.test(m)) {
        cat = "1. {NICKNAME} (玩家昵称)";
      } else if (/^\{RUBY#/i.test(m)) {
        cat = "2. {RUBY#[S/D]...} (注音/文本上方小字说明)";
      } else if (/^\{[MF]#/i.test(m)) {
        cat = "3. {M#...}/{F#...} (主角性别差异对白/称谓)";
      } else if (m.includes("SEXPRO") || m.includes("PLAYERAVATAR") || m.includes("MATEAVATAR")) {
        cat = "4. {PLAYERAVATAR/MATEAVATAR#SEXPRO[...]} (双子代词系统标签)";
      } else if (/^\{REALNAME/i.test(m)) {
        cat = "5. {REALNAME[...]} (主角真实姓名)";
      } else if (/^\{LAYOUT_/i.test(m)) {
        cat = "6. {LAYOUT_PC/MOBILE/PS#...} (跨平台按键提示)";
      } else if (/^\{ABYSSWAR#/i.test(m)) {
        cat = "7. {ABYSSWAR#...} (纳塔战争烈士计数剧情变量)";
      } else if (m.includes("#")) {
        const prefix = m.slice(1, m.indexOf("#"));
        cat = `8. {${prefix}#...} (其他带参数标签)`;
      } else {
        cat = `9. {${m.slice(1, -1)}} (其他无参数标签)`;
      }

      const entry = patternCategories.get(cat) || {
        count: 0,
        examples: new Set<string>(),
        rawTags: new Set<string>(),
      };
      entry.count++;
      if (entry.examples.size < 6) entry.examples.add(text.trim());
      if (entry.rawTags.size < 15) entry.rawTags.add(m);
      patternCategories.set(cat, entry);
    }
  }

  for (const r of nodes.rows) record(r.body);
  for (const r of docs.rows) {
    record(r.title);
    record(r.body);
  }
  for (const r of subquests.rows) {
    record(r.title);
    record(r.objective);
  }

  console.log("\n======================================================");
  console.log("            CATEGORIES TOTAL SUMMARY TABLE            ");
  console.log("======================================================");
  const sortedCats = [...patternCategories.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [cat, data] of sortedCats) {
    console.log(`- ${cat.padEnd(55)}: ${data.count} 次`);
  }

  // 1. RUBY deep inspection
  console.log("\n======================================================");
  console.log("              1. RUBY DETAILED ANALYSIS               ");
  console.log("======================================================");
  const rubyRows = await pool.query(`
    SELECT body FROM knowledge.quest_dialogue_nodes
    WHERE body LIKE '%{RUBY#%'
  `);
  console.log(`Total dialogue nodes containing RUBY: ${rubyRows.rowCount}`);
  const sList = new Set<string>();
  const dList = new Set<string>();
  for (const r of rubyRows.rows) {
    const text = r.body || "";
    const matches = text.match(/\S*\{RUBY#\[([SD])\]([^}]+)\}\S*/g);
    if (matches) {
      for (const m of matches) {
        if (m.includes("[S]")) sList.add(m);
        if (m.includes("[D]")) dList.add(m);
      }
    }
  }
  let mfPairCount = 0;
  let fmPairCount = 0;
  let singleMCount = 0;
  let singleFCount = 0;
  const sexproVariants = new Map<string, number>();
  const realnameVariants = new Map<string, number>();

  for (const r of nodes.rows) {
    const text = r.body || "";
    if (text.includes("{M#") || text.includes("{F#")) {
      const mfMatches = text.match(/\{M#[^}]+\}\{F#[^}]+\}/g);
      if (mfMatches) mfPairCount += mfMatches.length;
      const fmMatches = text.match(/\{F#[^}]+\}\{M#[^}]+\}/g);
      if (fmMatches) fmPairCount += fmMatches.length;
      const stripped = text.replace(/\{M#[^}]+\}\{F#[^}]+\}/g, "").replace(/\{F#[^}]+\}\{M#[^}]+\}/g, "");
      const singleM = stripped.match(/\{M#[^}]+\}/g);
      if (singleM) singleMCount += singleM.length;
      const singleF = stripped.match(/\{F#[^}]+\}/g);
      if (singleF) singleFCount += singleF.length;
    }
    const spMatches = text.match(/\{(?:PLAYERAVATAR|MATEAVATAR)#SEXPRO\[[^\]]+\]\}/g);
    if (spMatches) {
      for (const m of spMatches) sexproVariants.set(m, (sexproVariants.get(m) || 0) + 1);
    }
    const rnMatches = text.match(/\{REALNAME[^}]*\}/g);
    if (rnMatches) {
      for (const m of rnMatches) realnameVariants.set(m, (realnameVariants.get(m) || 0) + 1);
    }
  }

  const sortedRaw = [...rawTags.entries()].sort((a, b) => b[1] - a[1]);

  const report = {
    summary: Object.fromEntries([...patternCategories.entries()].map(([k, v]) => [k, v.count])),
    sRubySamples: [...sList].slice(0, 30),
    dRubySamples: [...dList].slice(0, 30),
    genderStats: {
      mfPairCount,
      fmPairCount,
      singleMCount,
      singleFCount,
    },
    sexproVariants: Object.fromEntries(sexproVariants.entries()),
    realnameVariants: Object.fromEntries(realnameVariants.entries()),
    topRawTags: Object.fromEntries(sortedRaw.slice(0, 50)),
  };

  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/placeholders-analysis.json", JSON.stringify(report, null, 2));
  console.log("Analysis saved to reports/placeholders-analysis.json");

  await pool.end();
}

inspectTags().catch(console.error);
