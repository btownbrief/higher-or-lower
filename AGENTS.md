# Higher or Lower: BTV — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first for how the game works — this file only adds the rules an
agent needs so it doesn't break something.

## What this is
Plain static site, **no build step**: `index.html` + `style.css` + ES modules in
`js/`. Guess whether a hidden local stat is higher or lower than the one showing.
Deployed by GitHub Pages via `.github/workflows/deploy.yml` on push. Stephen is
non-technical — explain consequential changes in plain language.

## Rules that will trip you up
- **`data/stats.json` is machine-maintained — do not hand-edit.** The monthly Action
  `.github/workflows/refresh.yml` (`scripts/refresh-stats.mjs`) has Claude (with web
  search) re-verify the 10 stalest values and add one new comparison group, then
  **validates hard and commits nothing on failure.** Preserve that invariant.
- **Gameplay invariants live in the data shape** — respect them if you touch stats or
  logic: comparisons only happen **within one comparison group that shares a unit**;
  values within ~5% are never paired; nothing repeats within a run; every value carries
  an "as of" date and a source link. Don't add a stat without a dated source.
- Monthly leaderboard on the **shared Btown Games Supabase backend** (`js/leaderboard.js`,
  slug `higher-or-lower`). Public anon key calls security-definer RPCs only — no secrets
  in client JS.

## Runtime AI (leave on Claude)
`refresh.yml` calls the Anthropic API via the `ANTHROPIC_API_KEY` repo secret to verify
and add stats. Runtime generation, independent of the coding assistant — don't switch
providers unless Stephen asks.

## Before you finish
No test suite. If you touched the refresh script, run it locally and confirm
`data/stats.json` still parses and the site loads. Say what you verified.
