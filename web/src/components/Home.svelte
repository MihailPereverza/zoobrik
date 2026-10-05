<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { deckSummary, topicSummary } from '../lib/summary';

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const summary = $derived(deckSummary(data, now));
  const topics = $derived(data.topics.map((t) => topicSummary(data, t, now)));
  const canStart = $derived(summary.due > 0 || summary.batch !== null);
  const pct = (n: number, total: number) => `${(n / Math.max(1, total)) * 100}%`;
</script>

<div class="wrap">
  <section class="hero">
    <div class="intro">
      <div class="eyebrow">{data.deck.name}</div>
      <h1 class="display">
        {#if summary.due > 0}Пора повторить {summary.due} {summary.due === 1 ? 'слово' : summary.due < 5 ? 'слова' : 'слов'}
        {:else if summary.batch}Новая порция: {summary.batch.topic.title}
        {:else}На сегодня всё{/if}
      </h1>
      <p class="muted lede">
        {#if summary.batch}
          {summary.batch.cards.map((c) => c.content.en ?? c.content.title).join(', ')}
          {summary.due > 0 ? ' — после повторения.' : ''}
        {:else if summary.due === 0}
          Новые слова откроются, когда закрепятся текущие. Загляните позже.
        {:else}
          Слова идут циклами по темам: каждое — несколькими разными заданиями вперемешку с соседями.
        {/if}
      </p>
      <a class="btn start" class:disabled={!canStart} href={canStart ? '#/session' : undefined} aria-disabled={!canStart}>
        {canStart ? 'Начать занятие' : 'Нечего учить'}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
      </a>
    </div>
    <dl class="figures">
      <div><dt>К повторению</dt><dd class="mono">{summary.due}</dd></div>
      <div><dt>В обучении</dt><dd class="mono">{summary.learning}</dd></div>
      <div><dt>Начато</dt><dd class="mono">{summary.introduced}<small>/{summary.cards}</small></dd></div>
      <div><dt>Заданий</dt><dd class="mono">{summary.exercises}</dd></div>
    </dl>
  </section>

  <h2 class="section">Темы</h2>
  <div class="topics">
    {#each topics as t (t.topic.id)}
      <a class="topic panel" href="#/topic/{t.topic.id}" class:locked={!t.open}>
        <div class="row">
          <span class="eyebrow">{t.topic.kind === 'grammar' ? 'Грамматика' : 'Слова'}{t.topic.level ? ` · ${t.topic.level}` : ''}</span>
          {#if t.due}<span class="chip learning">{t.due} к повторению</span>
          {:else if !t.open}<span class="chip off">закрыта</span>{/if}
        </div>
        <h3>{t.topic.title}</h3>
        <div class="stagebar" aria-hidden="true">
          <i class="s-mastered" style:width={pct(t.counts.mastered, t.total)}></i>
          <i class="s-review" style:width={pct(t.counts.review, t.total)}></i>
          <i class="s-learning" style:width={pct(t.counts.learning, t.total)}></i>
        </div>
        <div class="meta mono">
          <span>{t.total - t.counts.new}/{t.total} начато</span>
          {#if !t.open && t.topic.requires?.length}<span>после: {t.topic.requires.map((id) => data.topics.find((x) => x.id === id)?.title ?? id).join(', ')}</span>{/if}
        </div>
      </a>
    {/each}
  </div>
</div>

<style>
  .hero { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 32px; align-items: end; padding-block: 40px 8px; }
  @media (max-width: 760px) { .hero { grid-template-columns: minmax(0, 1fr); gap: 24px; padding-top: 28px; } }
  .lede { max-width: 56ch; margin: 0 0 22px; }
  .start svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; }
  .start.disabled { opacity: .4; pointer-events: none; }
  .figures { display: grid; grid-template-columns: 1fr 1fr; margin: 0; border: 1px solid var(--rule); border-radius: 12px; background: var(--card); overflow: hidden; }
  .figures div { padding: 14px 16px; border-bottom: 1px solid var(--rule); }
  .figures div:nth-child(odd) { border-right: 1px solid var(--rule); }
  .figures div:nth-last-child(-n + 2) { border-bottom: 0; }
  dt { font: 500 11px/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
  dd { margin: 6px 0 0; font-size: 28px; font-weight: 500; }
  dd small { font-size: 14px; color: var(--ink-3); }
  .topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
  .topic { display: grid; gap: 10px; padding: 16px; text-decoration: none; transition: border-color .15s, transform .15s; }
  .topic:hover { border-color: var(--rule-strong); transform: translateY(-1px); }
  .topic.locked { opacity: .62; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 20px; }
  h3 { font: 600 17px/1.25 var(--font-body); margin: 0; }
  .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--ink-3); flex-wrap: wrap; }
</style>
