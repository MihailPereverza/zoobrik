<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { plural } from '../lib/activity';
  import { log } from '../lib/log';
  import { bestScore, Feed, MIN_WORDS, ROUNDS, ROWS, saveBest, speedPairs, WRONG_PENALTY_S, type Pair } from '../lib/speed';

  type Phase = 'ready' | 'play' | 'between' | 'over';
  type Mark = '' | 'ok' | 'bad';
  const pairs = speedPairs(app.data!);
  const enough = pairs.length >= MIN_WORDS;

  let phase = $state<Phase>('ready');
  let round = $state(0);
  let matched = $state(0);
  let score = $state(0);
  let streak = $state(0);
  let best = $state(bestScore());
  let record = $state(false);
  let left = $state<(Pair | null)[]>([]);
  let right = $state<(Pair | null)[]>([]);
  let marks = $state<{ left: Mark[]; right: Mark[] }>({ left: [], right: [] });
  let pickedLeft = $state<number | null>(null);
  let pickedRight = $state<number | null>(null);
  let deadline = 0;
  let msLeft = $state(0);
  let penalty = $state(false);
  let feed = new Feed(pairs);
  let ticker: ReturnType<typeof setInterval> | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, fn: () => void) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const onBoard = () => [...left, ...right].filter((p): p is Pair => p !== null);
  const goal = $derived(ROUNDS[round]?.goal ?? 0);
  const seconds = $derived(ROUNDS[round]?.seconds ?? 1);

  function deal() {
    feed = new Feed(pairs);
    const dealt: Pair[] = [];
    for (let i = 0; i < ROWS; i++) { const p = feed.next(dealt); if (p) dealt.push(p); }
    left = Array.from({ length: ROWS }, (_, i) => dealt[i] ?? null);
    right = [...left].sort(() => Math.random() - 0.5);
    marks = { left: Array(ROWS).fill(''), right: Array(ROWS).fill('') };
    pickedLeft = pickedRight = null;
  }

  function startRound(n: number) {
    round = n; matched = 0; streak = 0;
    deal();
    deadline = Date.now() + ROUNDS[n].seconds * 1000;
    msLeft = ROUNDS[n].seconds * 1000;
    phase = 'play';
    clearInterval(ticker);
    ticker = setInterval(tickClock, 100);
    log('speed', 'round', { round: n + 1, words: pairs.length });
  }

  function start() { score = 0; record = false; startRound(0); }

  function tickClock() {
    msLeft = Math.max(0, deadline - Date.now());
    if (msLeft === 0) finish();
  }

  function stopClock() { clearInterval(ticker); timers.forEach(clearTimeout); timers.clear(); }

  function finish() {
    stopClock();
    record = score > best;
    saveBest(score);
    best = Math.max(best, score);
    phase = 'over';
    log('speed', 'over', { score, round: round + 1 });
  }

  function pick(side: 'left' | 'right', i: number) {
    if (phase !== 'play' || !(side === 'left' ? left : right)[i] || marks[side][i]) return;
    if (side === 'left') pickedLeft = pickedLeft === i ? null : i; else pickedRight = pickedRight === i ? null : i;
    if (pickedLeft !== null && pickedRight !== null) judge(pickedLeft, pickedRight);
  }

  function judge(l: number, r: number) {
    pickedLeft = pickedRight = null;
    if (left[l]!.id === right[r]!.id) { matchedPair(l, r); return; }
    streak = 0;
    deadline -= WRONG_PENALTY_S * 1000;
    penalty = true;
    later(500, () => (penalty = false));
    navigator.vibrate?.([20, 40, 20]);
    marks.left[l] = 'bad'; marks.right[r] = 'bad';
    later(420, () => { marks.left[l] = ''; marks.right[r] = ''; });
  }

  function matchedPair(l: number, r: number) {
    matched += 1; score += 1; streak += 1;
    navigator.vibrate?.(12);
    marks.left[l] = 'ok'; marks.right[r] = 'ok';
    later(260, () => {
      left[l] = null; right[r] = null; marks.left[l] = ''; marks.right[r] = '';
      if (matched >= goal) { nextRound(); return; }
      later(280, () => { const p = feed.next(onBoard()); if (p) { left[l] = p; right[r] = p; } });
    });
  }

  function nextRound() {
    stopClock();
    if (round + 1 >= ROUNDS.length) { finish(); return; }
    phase = 'between';
  }

  onDestroy(stopClock);
</script>

<div class="narrow speed">
  <div class="head">
    <a class="close" href="#/" aria-label="Выйти"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></a>
    {#if phase === 'play'}
      <div class="bar" role="progressbar" aria-label="Пары раунда" aria-valuemin="0" aria-valuemax={goal} aria-valuenow={matched}><span style="width: {(matched / goal) * 100}%"></span></div>
      <span class="clock num" class:low={msLeft < 10000} class:penalty>{Math.ceil(msLeft / 1000)}</span>
    {/if}
  </div>

  {#if phase === 'play'}
    <div class="time" aria-hidden="true"><span style="transform: scaleX({msLeft / (seconds * 1000)})"></span></div>
    <p class="round muted">Раунд {round + 1} из {ROUNDS.length} · {matched} из {goal}{#if streak >= 3}<b class="streak"> · {streak} подряд</b>{/if}</p>
    <div class="board">
      {#each Array(ROWS) as _, i (i)}
        <button class="cell en {marks.left[i]}" class:picked={pickedLeft === i} type="button" disabled={!left[i]} onclick={() => pick('left', i)}>{left[i]?.en ?? ''}</button>
        <button class="cell ru {marks.right[i]}" class:picked={pickedRight === i} type="button" disabled={!right[i]} onclick={() => pick('right', i)}>{right[i]?.ru ?? ''}</button>
      {/each}
    </div>
  {:else}
    <section class="screen">
      {#if phase === 'ready'}
        <h1 class="display">Пары на время</h1>
        {#if enough}
          <p class="lead">Соединяй слово и перевод. {ROUNDS.length} раунда по {ROUNDS[0].goal} пар, и с каждым раундом времени меньше: {ROUNDS.map((r) => r.seconds).join(', ')} секунд. Ошибка отнимает {WRONG_PENALTY_S} секунды.</p>
          <p class="muted small">Только уже начатые слова. На расписание повторений не влияет.</p>
          {#if best}<p class="best">Рекорд: <b class="num">{best}</b> {plural(best, 'пара', 'пары', 'пар')}</p>{/if}
          <button class="btn amber block" type="button" onclick={start}>Начать</button>
        {:else}
          <p class="lead">Нужно хотя бы {MIN_WORDS} начатых слов, а пока их {pairs.length}. После пары обычных сессий здесь можно будет играть.</p>
          <a class="btn block" href="#/">К занятиям</a>
        {/if}
      {:else if phase === 'between'}
        <h1 class="display">Раунд {round + 1} пройден</h1>
        <p class="lead">Дальше {ROUNDS[round + 1].goal} пар за {ROUNDS[round + 1].seconds} секунд.</p>
        <button class="btn amber block" type="button" onclick={() => startRound(round + 1)}>Раунд {round + 2}</button>
      {:else}
        <h1 class="display">{matched >= goal && round === ROUNDS.length - 1 ? 'Все раунды пройдены' : 'Время вышло'}</h1>
        <p class="score"><b class="num">{score}</b> {plural(score, 'пара', 'пары', 'пар')}</p>
        <p class="best">{record ? 'Новый рекорд!' : `Рекорд: ${best}`}</p>
        <div class="actions">
          <button class="btn amber block" type="button" onclick={start}>Ещё раз</button>
          <a class="btn ghost block" href="#/">Готово</a>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .speed { padding-top: 8px; padding-bottom: 24px; }
  .head { display: flex; align-items: center; gap: 12px; min-height: 44px; }
  .close { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; color: var(--ink-2); flex: none; }
  .close svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .bar { flex: 1; height: 10px; border-radius: 5px; background: var(--soft); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--good); border-radius: 5px; transition: width 240ms var(--ease); }
  .clock { width: 44px; text-align: right; font: 600 20px/1 var(--font-mono); color: var(--ink); transition: color 200ms var(--ease); }
  .clock.low { color: var(--again); }
  .clock.penalty { animation: zb-shakeX 400ms var(--ease); color: var(--again); }
  .time { height: 4px; margin: 10px 0 0; border-radius: 2px; background: var(--soft); overflow: hidden; }
  .time span { display: block; height: 100%; background: var(--amber); transform-origin: 0 50%; transition: transform 100ms linear; }
  .round { margin: 12px 2px 14px; font-size: 14px; }
  .streak { color: var(--good); font-weight: 600; }
  .board { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .cell { min-height: 64px; padding: 8px 10px; border-radius: 14px; border: 1px solid var(--rule-strong); background: var(--card); color: var(--ink); box-shadow: 0 2px 0 var(--rule-strong); font: 500 16px/1.25 var(--font-body); text-align: center; overflow-wrap: anywhere; cursor: pointer; touch-action: manipulation; transition: background-color 120ms var(--ease), border-color 120ms var(--ease), transform 120ms var(--ease); }
  .cell.en { font-weight: 600; }
  .cell:active { transform: translateY(2px); box-shadow: none; }
  .cell.picked { background: var(--easy-bg); border-color: var(--easy); box-shadow: 0 2px 0 var(--easy); }
  .cell.ok { background: var(--good-bg); border-color: var(--good); box-shadow: 0 2px 0 var(--good); color: var(--good-deep); }
  .cell.bad { background: var(--again-bg); border-color: var(--again); box-shadow: 0 2px 0 var(--again); animation: zb-shakeX 400ms var(--ease); }
  .cell:disabled { background: transparent; border-style: dashed; border-color: var(--line); box-shadow: none; cursor: default; }
  .screen { display: grid; gap: 14px; margin-top: 24px; }
  .lead { margin: 0; font-size: 17px; line-height: 1.5; color: var(--ink-2); }
  .small { margin: 0; font-size: 14px; }
  .best { margin: 0; font-size: 15px; color: var(--ink-2); }
  .score { margin: 8px 0 0; font-size: 18px; color: var(--ink-2); }
  .score b { font: 600 56px/1 var(--font-display); color: var(--ink); margin-right: 6px; }
  .actions { display: grid; gap: 10px; margin-top: 8px; }
  :global([data-theme="night"]) .cell.ok, :global([data-theme="night"]) .cell.picked { color: var(--ink); }
</style>
