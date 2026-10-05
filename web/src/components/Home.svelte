<script lang="ts">
  import { onMount } from 'svelte';
  import Ring from './Ring.svelte';
  import { app, backend } from '../lib/state.svelte';
  import { deckSummary, topicSummary } from '../lib/summary';
  import { dayStats, greeting, plural } from '../lib/activity';

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const summary = $derived(deckSummary(data, now));
  const topics = $derived(data.topics.map((t) => topicSummary(data, t, now)));
  const canStart = $derived(summary.due > 0 || summary.batch !== null);
  const pct = (n: number, total: number) => `${(n / Math.max(1, total)) * 100}%`;
  const titleOf = (id: string) => data.topics.find((x) => x.id === id)?.title ?? id;

  let activity = $state<Record<string, number>>({});
  const days = $derived(dayStats(activity, now));
  onMount(() => { backend().activity().then((a) => (activity = a)).catch(() => {}); });
</script>

<div class="wrap">
  <div class="hello appear">
    <span>{greeting()}</span>
    {#if days.streak > 0}
      <span class="streak" title="Дней подряд с занятиями">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.6.2 1.7 1 2.6 1.8 2.9C10.4 8.9 11 5.6 12 3z" /></svg>
        {days.streak} {plural(days.streak, 'день', 'дня', 'дней')} подряд
      </span>
    {/if}
  </div>

  <section class="today surface appear">
    <div class="top">
      <div class="text">
        <h1 class="display">
          {#if summary.due > 0}{summary.due} {plural(summary.due, 'слово', 'слова', 'слов')} к повторению
          {:else if summary.batch}Новые слова
          {:else}На сегодня всё{/if}
        </h1>
        <p class="muted">
          {#if summary.batch}{summary.batch.cards.map((c) => c.content.en ?? c.content.title).join(', ')}{summary.due ? ' — после повторения' : ''}
          {:else if summary.due === 0}Новые слова откроются, когда закрепятся текущие.
          {:else}Тема за темой, каждое слово — несколькими заданиями.{/if}
        </p>
      </div>
      <Ring value={days.today} max={app.goal} label="заданий сегодня" />
    </div>
    {#if canStart}<a class="btn start" href="#/session">{days.today ? 'Продолжить' : 'Начать занятие'}</a>{/if}
    <div class="stats num">
      <div><b>{summary.introduced}</b><span>из {summary.cards} начато</span></div>
      <div><b>{summary.learning}</b><span>в обучении</span></div>
      <div><b>{days.days}</b><span>{plural(days.days, 'день', 'дня', 'дней')} занятий</span></div>
    </div>
  </section>

  <h2 class="section">Темы</h2>
  <ul class="topics surface appear" style="animation-delay: .06s">
    {#each topics as t (t.topic.id)}
      <li class:locked={!t.open}>
        <a href="#/topic/{t.topic.id}">
          <div class="text">
            <span class="name">{t.topic.title}</span>
            {#if !t.open && t.topic.requires?.length}<span class="after">После «{t.topic.requires.map(titleOf).join('», «')}»</span>
            {:else if t.total - t.counts.new > 0}<span class="stagebar" aria-hidden="true"><i class="s-mastered" style:width={pct(t.counts.mastered, t.total)}></i><i class="s-review" style:width={pct(t.counts.review, t.total)}></i><i class="s-learning" style:width={pct(t.counts.learning, t.total)}></i></span>{/if}
          </div>
          <span class="right num">{#if t.due}<span class="due">{t.due}</span>{/if}{t.total - t.counts.new}/{t.total}</span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </a>
      </li>
    {/each}
  </ul>
</div>

<style>
  .hello { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 26px 6px 12px; font-size: 15px; color: var(--ink-2); }
  .streak { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--hard); background: var(--card); padding: 6px 11px 6px 9px; border-radius: 999px; border: 1px solid var(--line); }
  .streak svg { width: 15px; height: 15px; fill: currentColor; }
  .today { padding: 26px 24px 20px; display: grid; }
  .top { display: flex; gap: 18px; align-items: flex-start; justify-content: space-between; }
  .text p { margin: 0 0 22px; max-width: 46ch; }
  .start { justify-self: start; min-width: 220px; }
  @media (max-width: 520px) { .start { justify-self: stretch; } .today { padding: 22px 18px 16px; } }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--rule); }
  .stats div { display: grid; gap: 2px; }
  .stats b { font-size: 20px; font-weight: 600; }
  .stats span { font-size: 12px; color: var(--ink-3); }
  .topics { list-style: none; padding: 4px 0; margin: 0 0 24px; overflow: hidden; }
  .topics li + li a { border-top: 1px solid var(--rule); }
  .topics li { padding-inline: 18px; transition: background-color .2s; }
  .topics a { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 12px; padding: 15px 0; text-decoration: none; align-items: center; }
  .topics li:hover { background: var(--card-2); }
  .text { display: grid; gap: 7px; min-width: 0; }
  .name { font-size: 16px; }
  .right { font-size: 13px; color: var(--ink-3); display: flex; gap: 8px; align-items: center; }
  .due { background: var(--accent); color: var(--on-accent); border-radius: 999px; padding: 2px 8px; font-size: 12px; }
  .stagebar { max-width: 200px; }
  .after { font-size: 13px; color: var(--ink-3); }
  .locked .name { color: var(--ink-3); }
  .chev { width: 16px; height: 16px; fill: none; stroke: var(--ink-3); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
</style>
