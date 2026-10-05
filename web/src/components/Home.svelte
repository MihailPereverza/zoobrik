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
  <section class="today">
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
    {#if canStart}<a class="btn" href="#/session">Начать</a>{/if}
    <p class="stats muted num">Начато {summary.introduced} из {summary.cards} · в обучении {summary.learning}</p>
  </section>

  <h2 class="section">Темы</h2>
  <ul class="topics">
    {#each topics as t (t.topic.id)}
      <li class:locked={!t.open}>
        <a href="#/topic/{t.topic.id}">
          <span class="name">{t.topic.title}</span>
          <span class="right num">
            {#if t.due}<span class="due">{t.due} к повторению</span>{/if}
            {t.total - t.counts.new}/{t.total}
          </span>
          {#if t.total - t.counts.new > 0}<span class="stagebar" aria-hidden="true">
            <i class="s-mastered" style:width={pct(t.counts.mastered, t.total)}></i>
            <i class="s-review" style:width={pct(t.counts.review, t.total)}></i>
            <i class="s-learning" style:width={pct(t.counts.learning, t.total)}></i>
          </span>{/if}
          {#if !t.open && t.topic.requires?.length}<span class="after">после «{t.topic.requires.map(titleOf).join('», «')}»</span>{/if}
        </a>
      </li>
    {/each}
  </ul>
</div>

<style>
  .today { padding-top: 48px; display: grid; gap: 4px; justify-items: start; }
  .today p { margin: 0 0 16px; max-width: 52ch; }
  .today .stats { margin: 20px 0 0; font-size: 13px; }
  .topics { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--rule); }
  .topics li { border-bottom: 1px solid var(--rule); }
  .topics a { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; padding: 14px 0; text-decoration: none; align-items: baseline; }
  .topics a:hover .name { text-decoration: underline; text-underline-offset: 3px; }
  .name { font-size: 16px; }
  .right { font-size: 13px; color: var(--ink-3); display: flex; gap: 12px; }
  .due { color: var(--ink); }
  .stagebar { grid-column: 1 / -1; height: 2px; }
  .after { grid-column: 1 / -1; font-size: 13px; color: var(--ink-3); margin-top: -2px; }
  .locked .name { color: var(--ink-3); }
</style>
