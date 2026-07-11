#!/usr/bin/env node
// Monthly stats refresher for HIGHER or LOWER: BTV.
//
// Asks Claude (with web search enabled) to (a) re-verify the 10 stalest
// values in data/stats.json and update them with fresh sources, and
// (b) contribute one brand-new comparison group. Everything is validated
// hard; if the response is unusable the file is left untouched and the
// run fails loudly.
//
// No dependencies — plain Node 18+. Run manually:  node scripts/refresh-stats.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'stats.json');
const MODEL = 'claude-sonnet-5';
const STALE_COUNT = 10;
const MIN_GAP = 0.05;

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }

const data = JSON.parse(readFileSync(FILE, 'utf8'));

// ---------------------------------------------------------------- stalest 10
const flat = [];
for (const g of data.groups) for (const it of g.items) flat.push({ g, it });
flat.sort((a, b) => String(a.it.verified || '0').localeCompare(String(b.it.verified || '0')));
const stale = flat.slice(0, STALE_COUNT);

const staleList = stale.map(({ g, it }, i) =>
  `${i + 1}. category="${g.category}" label="${it.label}" current value=${it.value} ${g.unit} (asOf ${it.asOf}, source ${it.sourceUrl})`).join('\n');

const existingCategories = data.groups.map((g) => `- ${g.category} (${g.unit})`).join('\n');

const prompt = `You are the data editor for "HIGHER or LOWER: BTV", a Burlington, Vermont stats game by the BTown Brief newsletter. The game compares numeric local stats that share the SAME UNIT within a category.

Do BOTH tasks, using web search to verify every number:

TASK 1 — Re-verify these ${stale.length} existing stats. For each, search for the current/most authoritative figure. If the value changed, supply the new value; if unchanged, repeat the same value. Always supply a working source URL and the date the figure describes.
${staleList}

TASK 2 — Invent ONE new comparison group NOT already in this list:
${existingCategories}
Rules for the new group: a Burlington/Vermont theme; every item measured in the exact same unit; 6-10 items; values verified by web search with a source URL each; numeric values only (no years-as-values); values should span a wide range so comparisons are fun.

Reply with ONLY this JSON object (no markdown fences, no commentary):
{
  "updates": [
    {"category": "<exact category string from Task 1>", "label": "<exact label>", "value": <number>, "asOf": "<YYYY or YYYY-MM>", "sourceUrl": "https://..."}
  ],
  "newGroup": {
    "category": "<short title>",
    "emoji": "<one emoji>",
    "unit": "<unit shown to players>",
    "items": [
      {"label": "<name>", "value": <number>, "asOf": "<YYYY or YYYY-MM>", "sourceUrl": "https://..."}
    ]
  }
}`;

// ---------------------------------------------------------------- Claude + web search
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 16000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 20 }],
    messages: [{ role: 'user', content: prompt }],
  }),
});
if (!res.ok) {
  console.error(`Claude API error: HTTP ${res.status} — ${await res.text()}`);
  process.exit(1);
}
const msg = await res.json();
let text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
text = text.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
// the model may write prose around the JSON — grab the outermost object
const start = text.indexOf('{'), end = text.lastIndexOf('}');
if (start < 0 || end <= start) { console.error('No JSON object in response'); process.exit(1); }

let out;
try { out = JSON.parse(text.slice(start, end + 1)); }
catch (e) { console.error(`Could not parse response JSON: ${e.message}`); process.exit(1); }

// ---------------------------------------------------------------- validate hard
const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u);
const isAsOf = (s) => typeof s === 'string' && /^\d{4}(-\d{2})?$/.test(s);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nowTag = new Date().toISOString().slice(0, 7);

let applied = 0;
const updates = Array.isArray(out.updates) ? out.updates : [];
for (const u of updates) {
  if (!isNum(u.value) || !isUrl(u.sourceUrl) || !isAsOf(u.asOf)) { console.log(`drop update (invalid): ${u.label}`); continue; }
  const hit = stale.find(({ g, it }) => g.category === u.category && it.label === u.label);
  if (!hit) { console.log(`drop update (unknown target): ${u.category} / ${u.label}`); continue; }
  // reject wild swings (>10x either way) — likely a bad match, keep the old value
  if (hit.it.value !== 0 && (Math.abs(u.value) > Math.abs(hit.it.value) * 10 || Math.abs(u.value) < Math.abs(hit.it.value) / 10)) {
    console.log(`drop update (implausible swing): ${u.label} ${hit.it.value} -> ${u.value}`); continue;
  }
  hit.it.value = u.value;
  hit.it.asOf = u.asOf;
  hit.it.sourceUrl = u.sourceUrl;
  hit.it.verified = nowTag;
  applied++;
}
console.log(`Applied ${applied}/${stale.length} re-verifications.`);

let addedGroup = false;
const ng = out.newGroup;
if (ng && typeof ng.category === 'string' && ng.category.trim() &&
    typeof ng.unit === 'string' && ng.unit.trim() &&
    typeof ng.emoji === 'string' && ng.emoji.trim() &&
    Array.isArray(ng.items)) {
  const dupe = data.groups.some((g) => g.category.toLowerCase() === ng.category.toLowerCase());
  const items = ng.items.filter((it) =>
    typeof it.label === 'string' && it.label.trim() && isNum(it.value) && isUrl(it.sourceUrl) && isAsOf(it.asOf));
  const labels = new Set(items.map((i) => i.label));
  // group must offer real comparisons: at least one pair >5% apart
  let pairable = false;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (Math.abs(items[i].value - items[j].value) / Math.max(Math.abs(items[i].value), Math.abs(items[j].value)) > MIN_GAP) pairable = true;
  if (!dupe && items.length >= 6 && labels.size === items.length && pairable) {
    data.groups.push({
      category: ng.category.trim(),
      emoji: ng.emoji.trim(),
      unit: ng.unit.trim(),
      items: items.map((it) => ({
        label: it.label.trim(), value: it.value, asOf: it.asOf, verified: nowTag, sourceUrl: it.sourceUrl,
      })),
    });
    addedGroup = true;
    console.log(`Added new group "${ng.category}" with ${items.length} items.`);
  } else {
    console.log(`New group rejected (dupe=${dupe}, valid items=${items.length}).`);
  }
} else {
  console.log('No usable newGroup in response.');
}

if (applied === 0 && !addedGroup) {
  console.error('Nothing valid to apply — committing nothing.');
  process.exit(1);
}

data.updated = new Date().toISOString().slice(0, 10);
writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`Wrote data/stats.json (${data.groups.length} groups).`);
