// HIGHER or LOWER: BTV — local-stats streak game for Btown Games.
import {
  lbEnabled, getName, submitScore, renamePlayer, fetchTop, monthLabel, playerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);

const MIN_GAP = 0.05;        // never pair values within 5% of each other
const ROUNDS_PER_GROUP = 3;  // hop to a new category this often
const BEST_KEY = 'btown-hol-best';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let groups = [];
let group = null;          // current comparison group
let anchor = null, challenger = null;
let roundsInGroup = 0;
let streak = 0;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let usedLabels = new Set(); // "category|label" seen this run
let phase = 'intro';        // intro | guessing | revealing | over
let scoreSubmitted = false;
let runId = 0;
let roundTimer = null;
let milestoneTimer = null;

$('best').textContent = best;

// ------------------------------------------------------------ data
const res = await fetch('data/stats.json');
const data = await res.json();
groups = data.groups;
$('pool-flex').textContent =
  `${groups.length} categories · ${groups.reduce((n, g) => n + g.items.length, 0)} sourced local stats`;

// ------------------------------------------------------------ helpers
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const gapOK = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) > MIN_GAP;
const keyOf = (g, item) => `${g.category}|${item.label}`;

function fresh(g) { return g.items.filter((it) => !usedLabels.has(keyOf(g, it))); }

// a group is playable if some unused pair is >5% apart
function playable(g) {
  const f = fresh(g);
  for (let i = 0; i < f.length; i++)
    for (let j = i + 1; j < f.length; j++)
      if (gapOK(f[i].value, f[j].value)) return true;
  return false;
}

function pickGroup(exclude) {
  const candidates = groups.filter((g) => g !== exclude && playable(g));
  if (candidates.length === 0) return playable(exclude) ? exclude : null;
  return rand(candidates);
}

// pick a challenger from g that is >5% away from `from` and unused
function pickChallenger(g, from) {
  const opts = fresh(g).filter((it) => it !== from && gapOK(it.value, from.value));
  return opts.length ? rand(opts) : null;
}

// pick an anchor that has at least one valid challenger
function pickAnchor(g) {
  const f = fresh(g).filter((it) => fresh(g).some((o) => o !== it && gapOK(o.value, it.value)));
  return f.length ? rand(f) : null;
}

function fmt(value, g) {
  const dec = (String(value).split('.')[1] || '').length;
  const s = value.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (g.prefix || '') + s;
}

// ------------------------------------------------------------ rendering
function renderCategory() {
  $('catEmoji').textContent = group.emoji;
  $('catName').textContent = group.category;
  $('catUnit').textContent = group.unit;
  const b = $('catBanner');
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
}

function metaHTML(item) {
  return `as of ${item.asOf} · <a href="${item.sourceUrl}" target="_blank" rel="noopener">source</a>`;
}

function renderAnchor() {
  $('labelA').textContent = anchor.label;
  $('valueA').innerHTML = `${fmt(anchor.value, group)}<span class="unit-suffix">${group.unit}</span>`;
  $('metaA').innerHTML = metaHTML(anchor);
}

function renderChallenger() {
  const cardB = $('cardB');
  cardB.classList.add('mystery');
  cardB.classList.remove('reveal-good', 'reveal-bad');
  $('labelB').textContent = challenger.label;
  $('valueB').textContent = '?';
  $('metaB').classList.add('hidden');
  $('metaB').innerHTML = metaHTML(challenger);
  $('revealStatus').classList.add('hidden');
  $('verdict').className = '';
  $('verdict').textContent = '';
  $('gapNote').textContent = '';
  $('guessRow').classList.remove('hidden');
  $('hopNote').classList.add('hidden');
}

function renderCountValue(el, value, g) {
  if (!g) {
    el.textContent = Math.round(value).toLocaleString('en-US');
    return;
  }
  el.innerHTML = `${fmt(value, g)}<span class="unit-suffix">${g.unit}</span>`;
}

// the classic satisfying count-up
function countUp(el, target, g = null, ms = 750, activeRun = runId) {
  const dec = (String(target).split('.')[1] || '').length;
  const t0 = performance.now();
  return new Promise((resolve) => {
    let done = false;
    let frame = null;
    let fallback = null;
    const finish = (showTarget = true) => {
      if (done) return;
      done = true;
      if (frame) cancelAnimationFrame(frame);
      if (fallback) clearTimeout(fallback);
      if (showTarget && activeRun === runId) renderCountValue(el, target, g);
      resolve();
    };
    if (reducedMotion.matches || ms === 0) {
      finish();
      return;
    }
    renderCountValue(el, 0, g);
    function tick(t) {
      if (done) return;
      if (activeRun !== runId) { finish(false); return; }
      const p = Math.min((t - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Number((target * eased).toFixed(dec));
      renderCountValue(el, v, g);
      if (p < 1) frame = requestAnimationFrame(tick); else finish();
    }
    frame = requestAnimationFrame(tick);
    // rAF pauses in hidden tabs — make sure the reveal always lands
    fallback = setTimeout(finish, ms + 400);
  });
}

function scrambleDigits(el, target, g, activeRun, ms = 220) {
  if (reducedMotion.matches) return Promise.resolve();
  const template = fmt(target, g);
  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = false;
    let frame = null;
    let fallback = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (frame) cancelAnimationFrame(frame);
      if (fallback) clearTimeout(fallback);
      resolve();
    };
    function tick(t) {
      if (activeRun !== runId) { finish(); return; }
      const digits = template.replace(/\d/g, () => Math.floor(Math.random() * 10));
      el.innerHTML = `${digits}<span class="unit-suffix">${g.unit}</span>`;
      if (t - t0 < ms) frame = requestAnimationFrame(tick); else finish();
    }
    frame = requestAnimationFrame(tick);
    fallback = setTimeout(finish, ms + 100);
  });
}

function updateStreakDisplay(animate = false) {
  const isHot = streak >= 5;
  const badge = $('streakBadge');
  $('streak').textContent = streak;
  $('streakFlame').textContent = isHot ? '🔥' : '';
  badge.classList.toggle('streak-hot', isHot);
  badge.classList.remove('streak-tick');
  if (animate && !reducedMotion.matches) {
    void badge.offsetWidth;
    badge.classList.add('streak-tick');
  }
}

function showMilestone(activeRun) {
  const messages = {
    5: 'HEATING UP',
    10: 'DOUBLE DIGITS',
    20: 'QUEEN CITY LEGEND',
  };
  if (!messages[streak] || activeRun !== runId) return;
  clearTimeout(milestoneTimer);
  const pop = $('milestonePop');
  $('milestoneLabel').textContent = messages[streak];
  $('milestoneValue').textContent = `🔥 ${streak} STREAK 🔥`;
  pop.classList.remove('hidden', 'show');
  if (!reducedMotion.matches) void pop.offsetWidth;
  pop.classList.add('show');
  milestoneTimer = setTimeout(() => {
    if (activeRun !== runId) return;
    pop.classList.add('hidden');
    pop.classList.remove('show');
  }, 1100);
}

function scheduleRound(next, delay, activeRun) {
  clearTimeout(roundTimer);
  roundTimer = setTimeout(() => {
    roundTimer = null;
    if (activeRun === runId) next();
  }, delay);
}

function resetEffects() {
  clearTimeout(roundTimer);
  clearTimeout(milestoneTimer);
  roundTimer = null;
  milestoneTimer = null;
  $('milestonePop').classList.add('hidden');
  $('milestonePop').classList.remove('show');
}

// ------------------------------------------------------------ game flow
function startRun() {
  runId += 1;
  resetEffects();
  streak = 0;
  usedLabels = new Set();
  scoreSubmitted = false;
  updateStreakDisplay();
  $('intro').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('game').classList.remove('hidden');
  hopToGroup(null, false);
  phase = 'guessing';
}

function hopToGroup(exclude, announce) {
  const next = pickGroup(exclude);
  if (!next) { endRun(true); return; } // the whole database exhausted — a legend
  group = next;
  roundsInGroup = 0;
  anchor = pickAnchor(group);
  usedLabels.add(keyOf(group, anchor));
  challenger = pickChallenger(group, anchor);
  usedLabels.add(keyOf(group, challenger));
  renderCategory();
  renderAnchor();
  renderChallenger();
  if (announce) {
    const note = $('hopNote');
    note.textContent = `New category: ${group.category.toUpperCase()} ${group.emoji}`;
    note.classList.remove('hidden');
  }
}

async function guess(dir) {
  if (phase !== 'guessing') return;
  phase = 'revealing';
  const activeRun = runId;
  const revealedGroup = group;
  const revealedAnchor = anchor;
  const revealedChallenger = challenger;
  $('guessRow').classList.add('hidden');

  const isHigher = revealedChallenger.value > revealedAnchor.value;
  const correct = (dir === 'higher') === isHigher;

  const cardB = $('cardB');
  cardB.classList.remove('mystery');
  await scrambleDigits($('valueB'), revealedChallenger.value, revealedGroup, activeRun);
  if (activeRun !== runId) return;
  await countUp($('valueB'), revealedChallenger.value, revealedGroup, 750, activeRun);
  if (activeRun !== runId) return;
  $('metaB').classList.remove('hidden');

  const verdict = $('verdict');
  const gapRatio = isHigher
    ? revealedChallenger.value / revealedAnchor.value
    : revealedAnchor.value / revealedChallenger.value;
  const gap = `${gapRatio.toFixed(gapRatio >= 10 ? 0 : 1)}× ${isHigher ? 'higher' : 'lower'} than ${revealedAnchor.label}`;
  $('gapNote').textContent = gap;
  verdict.classList.remove('good', 'bad');
  if (correct) {
    cardB.classList.add('reveal-good');
    verdict.classList.add('good');
    streak += 1;
    updateStreakDisplay(true);
    verdict.textContent = `✓ ${isHigher ? 'HIGHER' : 'LOWER'} — streak ${streak}`;
    $('revealStatus').classList.remove('hidden');
    showMilestone(activeRun);
    scheduleRound(advance, 1300, activeRun);
  } else {
    cardB.classList.add('reveal-bad');
    verdict.classList.add('bad');
    verdict.textContent = `✗ It was ${isHigher ? 'HIGHER' : 'LOWER'}`;
    $('revealStatus').classList.remove('hidden');
    scheduleRound(() => endRun(false), 1400, activeRun);
  }
}

function advance() {
  roundsInGroup += 1;
  if (roundsInGroup >= ROUNDS_PER_GROUP) { hopToGroup(group, true); phase = 'guessing'; return; }
  // challenger becomes the new anchor; find its next opponent in-group
  anchor = challenger;
  renderAnchor();
  challenger = pickChallenger(group, anchor);
  if (!challenger) { hopToGroup(group, true); phase = 'guessing'; return; } // group ran dry early
  usedLabels.add(keyOf(group, challenger));
  renderChallenger();
  phase = 'guessing';
}

function endRun(exhausted) {
  phase = 'over';
  clearTimeout(roundTimer);
  roundTimer = null;
  const activeRun = runId;
  const isBest = streak > best;
  if (isBest) { best = streak; localStorage.setItem(BEST_KEY, String(best)); }
  $('best').textContent = best;
  $('overTitle').textContent = exhausted ? 'YOU BEAT THE DATABASE!' : 'STREAK OVER';
  $('finalStreak').textContent = '0';
  const bl = $('bestLine');
  bl.textContent = isBest ? 'NEW BEST!' : `Best: ${best}`;
  bl.className = isBest ? 'best-line new-best' : 'best-line';
  $('finalSources').innerHTML =
    `<b>${anchor.label}</b>: ${fmt(anchor.value, group)} ${group.unit} (as of ${anchor.asOf}) — <a href="${anchor.sourceUrl}" target="_blank" rel="noopener">source</a><br>` +
    `<b>${challenger.label}</b>: ${fmt(challenger.value, group)} ${group.unit} (as of ${challenger.asOf}) — <a href="${challenger.sourceUrl}" target="_blank" rel="noopener">source</a>`;
  $('game').classList.add('hidden');
  $('gameover').classList.remove('hidden');
  countUp($('finalStreak'), streak, null, streak === 0 ? 0 : 650, activeRun);
  requestAnimationFrame(() => {
    if (phase === 'over' && activeRun === runId) $('restartBtn').focus({ preventScroll: true });
  });
  updateLeaderboard(streak);
}

// ------------------------------------------------------------ share
$('shareBtn').addEventListener('click', async () => {
  const bars = '📈'.repeat(Math.min(streak, 10)) + (streak === 0 ? '📉' : '') + '📉';
  const text = `HIGHER or LOWER: BTV ${bars}\nI ran a streak of ${streak} on Burlington stats. Beat it:`;
  const url = 'https://btownbrief.github.io/higher-or-lower/';
  try {
    if (navigator.share) await navigator.share({ text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('shareBtn').textContent = '✅ COPIED';
      setTimeout(() => { $('shareBtn').textContent = '📤 SHARE'; }, 1500);
    }
  } catch { /* user cancelled */ }
});

// ------------------------------------------------------------ input
$('startBtn').addEventListener('click', startRun);
$('restartBtn').addEventListener('click', startRun);
$('higherBtn').addEventListener('click', () => guess('higher'));
$('lowerBtn').addEventListener('click', () => guess('lower'));

document.addEventListener('keydown', (e) => {
  // never let keystrokes in the leaderboard name box drive the game
  if (e.target.tagName === 'INPUT') return;
  // focused buttons already handle Enter/Space natively
  if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button, a')) return;
  if (phase === 'guessing') {
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'h') { e.preventDefault(); guess('higher'); }
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'l') { e.preventDefault(); guess('lower'); }
  } else if (phase === 'over' && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault(); startRun();
  } else if (phase === 'intro' && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault(); startRun();
  }
});

// ------------------------------------------------------------ leaderboard
const lbBox = $('lb'), lbList = $('lbList'), lbStatus = $('lbStatus');
const lbForm = $('lbForm'), lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn'), lbLastBtn = $('lbLastBtn'), lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbBox.classList.remove('hidden');
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

async function updateLeaderboard(s) {
  if (!lbEnabled()) return;
  if (!getName()) {
    // first run: ask for a name before joining the board
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatus.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(s);
    return;
  }
  try {
    if (!scoreSubmitted) { scoreSubmitted = true; await submitScore(s); }
  } catch { /* offline — still try to show the board */ }
  renderBoard();
}

async function renderBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatus.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = playerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = `<span class="rank">${medal || i + 1}</span><span class="nm"></span><span class="sc"></span>`;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('.sc').textContent = r.score;
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatus.textContent = rows.length === 0
      ? 'No streaks yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatus.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + updates any existing rows
    if (pending > 0 && !scoreSubmitted) { scoreSubmitted = true; await submitScore(pending); }
  } catch { /* offline */ }
  renderBoard();
});
lbNameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = getName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderBoard();
});
