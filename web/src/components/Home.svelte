<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { deckSummary, topicSummary } from '../lib/summary';

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const summary = $derived(deckSummary(data, now));
  const topics = $derived(data.topics.map((t) => topicSummary(data, t, now)));
  const canStart = $derived(summary.due > 0 || summary.batch !== null);
  const pct = (n: number, total: number) => `${(n / Math.max(1, total)) * 100}%`;
  const plural = (n: number, one: string, few: string, many: string) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  const titleOf = (id: string) => data.topics.find((x) => x.id === id)?.title ?? id;
</script>

<div class="wrap">
  <section class="today surface appear">
    <div class="eyebrow">Сегодня</div>
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
    {#if canStart}<a class="btn start" href="#/session">Начать занятие</a>{/if}
    <div class="stats num">
      <div><b>{summary.introduced}</b><span>из {summary.cards} начато</span></div>
      <div><b>{summary.learning}</b><span>в обучении</span></div>
      <div><b>{summary.due}</b><span>к повторению</span></div>
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
  .today { margin-top: 24px; padding: 26px 24px 20px; display: grid; justify-items: start; }
  .today p { margin: 0 0 20px; max-width: 52ch; }
  .start { min-width: 200px; }
  @media (max-width: 520px) { .start { width: 100%; } .today { padding: 22px 18px 16px; } }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--rule); }
  .stats div { display: grid; gap: 2px; }
  .stats b { font-size: 20px; font-weight: 600; }
  .stats span { font-size: 12px; color: var(--ink-3); }
  .topics { list-style: none; padding: 4px 0; margin: 0; overflow: hidden; }
  .topics li + li a { border-top: 1px solid var(--rule); }
  .topics li { padding-inline: 18px; }
  .topics a { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 12px; padding: 15px 0; text-decoration: none; align-items: center; }
  .topics li:hover { background: var(--soft); }
  .text { display: grid; gap: 7px; min-width: 0; }
  .name { font-size: 16px; }
  .right { font-size: 13px; color: var(--ink-3); display: flex; gap: 8px; align-items: center; }
  .due { background: var(--ink); color: var(--card); border-radius: 999px; padding: 2px 8px; font-size: 12px; }
  .stagebar { max-width: 200px; }
  .after { font-size: 13px; color: var(--ink-3); }
  .locked .name { color: var(--ink-3); }
  .chev { width: 16px; height: 16px; fill: none; stroke: var(--ink-3); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
</style>
