<script lang="ts">
  import { onDestroy } from 'svelte';
  import Ring from './Ring.svelte';
  import TopicCard from './TopicCard.svelte';
  import Zubrik from './Zubrik.svelte';
  import { app } from '../lib/state.svelte';
  import { deckSummary, topicSummary } from '../lib/summary';
  import { dayStats, greeting, plural } from '../lib/activity';

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const summary = $derived(deckSummary(data, now));
  const topics = $derived(data.topics.map((t) => topicSummary(data, t, now)));
  const days = $derived(dayStats(app.activity, now));
  const canStart = $derived(summary.due > 0 || summary.batch !== null);
  const newCount = $derived(summary.batch?.cards.length ?? 0);
  const minutes = $derived(Math.max(1, Math.round(summary.due * 0.5 + newCount * 1.5)));
  const shown = $derived([...topics].sort((a, b) => b.due - a.due || Number(b.open) - Number(a.open)).slice(0, 4));
  const titleOf = (id: string) => data.topics.find((x) => x.id === id)?.title ?? id;

  let taps = $state(0);
  let bubble = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(timer));
  const lines = $derived([
    summary.due ? `Начнём с повторения: ${summary.due} ${plural(summary.due, 'слово', 'слова', 'слов')}.` : 'Повторять пока нечего — можно взять новые слова.',
    summary.batch ? `Новые сегодня: ${summary.batch.cards.map((c) => c.content.en ?? c.content.title).join(', ')}.` : 'Новые слова откроются, когда закрепятся текущие.',
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
  <p class="hello appear">{greeting()}</p>

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
        <div class="pic"><Zubrik mood={canStart ? 'hello' : 'sleep'} size={176} onpoke={poke} label="Зубрик: нажми, чтобы узнать план на сегодня" /></div>
      {/if}
    </section>
  </div>

  <section class="goal panel appear">
    <Ring value={days.today} max={app.goal} size={72} label="заданий сегодня" />
    <div class="goal-text">
      <b>{days.today >= app.goal ? 'Цель на сегодня выполнена' : 'Цель на сегодня'}</b>
      <span class="muted">{days.today} из {app.goal} заданий · начато {summary.introduced} из {summary.cards} слов</span>
    </div>
  </section>

  <div class="section-row">
    <h2 class="section">Темы</h2>
    <a class="all" href="#/topics">Все темы</a>
  </div>
  <div class="list">
    {#each shown as t, i (t.topic.id)}<TopicCard {t} delay={i * 60} {titleOf} />{/each}
  </div>
</div>

<style>
  .hello { margin: 4px 6px 12px; font-size: 15px; color: var(--ink-2); }
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
  .goal { margin-top: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 14px; }
  .goal-text { display: grid; gap: 2px; }
  .goal-text b { font-size: 16px; font-weight: 600; }
  .goal-text span { font-size: 13px; }
  .section-row { display: flex; justify-content: space-between; align-items: baseline; }
  .all { font-size: 14px; color: var(--ink-2); margin-right: 4px; }
  .list { display: grid; gap: 10px; }
</style>
