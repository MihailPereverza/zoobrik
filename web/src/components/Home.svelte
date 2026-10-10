<script lang="ts">
  import { onDestroy } from 'svelte';
  import Ring from './Ring.svelte';
  import Zubrik from './Zubrik.svelte';
  import { activeDeck, app } from '../lib/state.svelte';
  import { deckSummary } from '../lib/summary';
  import { dayStats, greeting, plural } from '../lib/activity';

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const summary = $derived(deckSummary(data, now));
  const days = $derived(dayStats(app.activity, now));
  const canStart = $derived(summary.due > 0 || summary.batch !== null);
  const newCount = $derived(summary.batch?.cards.length ?? 0);
  const minutes = $derived(Math.max(1, Math.round(summary.due * 0.5 + newCount * 1.5)));
  const deck = $derived(activeDeck());
  const others = $derived(app.decks.filter((d) => d.key !== deck?.key));

  let taps = $state(0);
  let bubble = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(timer));
  const lines = $derived([
    ...(days.today >= app.goal ? [`Норма на сегодня выполнена: ${days.today} из ${app.goal}. Я доволен!`] : []),
    summary.due ? `Начнём с повторения: ${summary.due} ${plural(summary.due, 'слово', 'слова', 'слов')}.` : 'Повторять пока нечего — можно взять новые слова.',
    summary.batch ? `Новые сегодня: ${summary.batch.cards.map((c) => c.content.term ?? c.content.title).join(', ')}.` : 'Новые слова откроются, когда закрепятся текущие.',
    days.streak ? `Серия — ${days.streak} ${plural(days.streak, 'день', 'дня', 'дней')}. Хватит пяти минут.` : 'Пять минут в день — и слова останутся с тобой.',
  ]);
  function poke() {
    if (app.mascotMode !== 'active') return;
    clearTimeout(timer);
    taps += 1;
    bubble = false;
    setTimeout(() => (bubble = true), 0);
    timer = setTimeout(() => (bubble = false), 3200);
  }
</script>

<div class="wrap">
  <div class="top-row appear">
    <p class="hello">{greeting()}</p>
    <a class="deck-chip" href="#/decks" aria-label="Колода: {data.deck.name}. Сменить колоду">
      <span class="mono">{deck?.lang.split(' → ')[0] ?? ''}</span>{data.deck.name}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
    </a>
  </div>

  <div class="hero-wrap appear">
    {#if bubble}<div class="bubble" role="status">{lines[(taps - 1) % lines.length]}</div>{/if}
    <section class="hero">
      <div class="text">
        <span class="title">Сегодня</span>
        <span class="facts">
          {#if summary.due || newCount}
            {#if summary.due}{summary.due} {plural(summary.due, 'повторение', 'повторения', 'повторений')}<br />{/if}
            {#if newCount}{newCount} {plural(newCount, 'новое слово', 'новых слова', 'новых слов')}{/if}
          {:else}Всё повторено{/if}
        </span>
        {#if canStart}<span class="time num">≈ {minutes} {plural(minutes, 'минута', 'минуты', 'минут')}</span>{/if}
        {#if canStart}<a class="btn amber start" href="#/session">{days.today ? 'Продолжить' : 'Начать сессию'}</a>{/if}
      </div>
      {#if app.mascotMode !== 'off'}
        <div class="pic"><Zubrik mood={days.today >= app.goal ? 'happy' : canStart ? 'hello' : 'sleep'} size={176} onpoke={poke} label="Зубрик: нажми, чтобы узнать план на сегодня" /></div>
      {/if}
    </section>
  </div>

  {#if data.placement?.length && !data.known}
    <a class="panel placement appear" href="#/placement">
      <span><b>Какие слова ты уже знаешь?</b><span class="muted">Тест на пару минут: задания будут только из знакомых слов</span></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </a>
  {/if}

  <section class="goal panel appear">
    <Ring value={days.today} max={app.goal} size={72} label="заданий сегодня" />
    <div class="goal-text">
      <b>{days.today >= app.goal ? 'Цель на сегодня выполнена' : 'Цель на сегодня'}</b>
      <span class="muted">{days.today} из {app.goal} заданий · начато {summary.introduced} из {summary.cards} слов</span>
    </div>
  </section>

  <a class="panel find appear" href="#/words">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
    <span>Найти слово или потренировать трудные</span>
  </a>

  {#if others.length}
    <h2 class="section">Другие колоды</h2>
    <div class="list">
      {#each others as d (d.key)}
        <a class="panel other" href="#/decks"><span class="mono lang">{d.lang}</span><b>{d.name}</b><span class="muted">{d.cards}</span></a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .top-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 4px 2px 12px 6px; }
  .hello { margin: 0; font-size: 15px; color: var(--ink-2); white-space: nowrap; }
  .deck-chip { min-width: 0; height: 36px; padding: 0 8px 0 6px; border-radius: 18px; background: var(--card); border: 1px solid var(--line); display: inline-flex; align-items: center; gap: 6px; text-decoration: none; color: var(--ink); font-size: 14px; font-weight: 500; }
  .deck-chip .mono { flex: none; height: 24px; padding: 0 6px; border-radius: 12px; background: var(--brand); color: var(--on-brand); font-size: 11px; display: grid; place-items: center; }
  .deck-chip svg { flex: none; width: 16px; height: 16px; fill: none; stroke: var(--ink-3); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .find { margin-top: 12px; display: flex; align-items: center; gap: 12px; padding: 16px; text-decoration: none; color: var(--ink-2); font-size: 15px; }
  .find svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; flex: none; }
  .other { display: flex; align-items: center; gap: 10px; padding: 14px 16px; text-decoration: none; color: var(--ink); }
  .other b { flex: 1; font-weight: 600; }
  .other .lang { font-size: 12px; color: var(--ink-2); }
  .hero-wrap { position: relative; }
  .hero { height: 228px; border-radius: 20px; background: var(--brand); overflow: hidden; display: flex; position: relative; }
  :global([data-theme="night"]) .hero { background: #2A211A; }
  .text { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 6px; position: relative; z-index: 1; }
  .title { font: 600 26px/1.1 var(--font-display); letter-spacing: -.02em; color: #F7F2EA; }
  .facts { font-size: 15px; line-height: 1.45; color: #E6DAC4; }
  .time { font: 400 13px/1 var(--font-mono); color: #C9AE92; }
  .start { margin-top: auto; width: 190px; height: 48px; }
  .pic { position: absolute; right: -12px; bottom: -6px; }
  .bubble { position: absolute; z-index: 2; top: 10px; right: 10px; width: 160px; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 14px 14px 4px 14px; padding: 9px 11px; font-size: 13px; line-height: 1.35; transform-origin: 100% 0; animation: zb-bubble 220ms var(--ease-out) both; }
  .placement { margin-top: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--ink); border-color: var(--rule-strong); }
  .placement > span { flex: 1; display: grid; gap: 2px; }
  .placement b { font-size: 16px; font-weight: 600; }
  .placement .muted { font-size: 13px; }
  .placement svg { width: 22px; height: 22px; flex: none; fill: none; stroke: var(--ink-3); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .goal { margin-top: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 14px; }
  .goal-text { display: grid; gap: 2px; }
  .goal-text b { font-size: 16px; font-weight: 600; }
  .goal-text span { font-size: 13px; }
  .list { display: grid; gap: 10px; }
</style>
