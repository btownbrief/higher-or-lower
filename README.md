# HIGHER or LOWER: BTV

Burlington, by the numbers. A local-stats streak game for [Btown Games](https://btownbrief.github.io/) — guess whether the hidden local stat is higher or lower than the one showing. Snowfall winters, town rents, mountain summits, maple syrup seasons, beer ABVs… every value sourced and dated.

**Play it:** https://btownbrief.github.io/higher-or-lower/

## How it works

- Comparisons only ever happen **within a comparison group that shares one unit** (`data/stats.json`): inches of snow vs inches of snow, rent vs rent.
- Values within ~5% of each other are never paired (no coin flips), and nothing repeats within a run.
- Every 3 correct answers the game hops to a new random category.
- Correct reveals count up from 0; every reveal shows the "as of" date and a source link.
- Streak = score. Monthly Supabase leaderboard shared across Btown Games (slug `higher-or-lower`).

## Keeping it fresh

`.github/workflows/refresh.yml` runs on the 1st of each month: Claude (with web search) re-verifies the 10 stalest values and contributes one new comparison group. `scripts/refresh-stats.mjs` validates everything hard and commits nothing on failure.

Plain static site — no build step. `index.html` + `style.css` + `js/` ES modules.

---
A Btown Games production · [Read the Btown Brief →](https://www.btownbrief.com)
