<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { renderMarkdown } from '../lib/md';
  import { retrievability } from '../lib/fsrs';
  import { cardSkills, orderedCards } from '../lib/scheduler';
  import { STAGE_LABEL, stageOf, topicSummary } from '../lib/summary';

  let { topicId }: { topicId: string } = $props();
  const data = $derived(app.data!);
  const topic = $derived(data.topics.find((t) => t.id === topicId));
  const now = $derived.by(() => { void app.version; return new Date(); });
  const summary = $derived(topic ? topicSummary(data, topic, now) : null);
  const batch = $derived(topic?.batch ?? 4);
</script>

<div class="wrap">
  {#if !topic || !summary}
    <p class="muted" style="margin-top:40px">Тема не найдена. <a href="#/">На главную</a></p>
  {:else}
    <a class="back" href="#/">← Все темы</a>
    <div class="eyebrow">{topic.kind === 'grammar' ? 'Грамматика' : 'Слова'}{topic.level ? ` · ${topic.level}` : ''} · порции по {batch}</div>
    <h1 class="display">{topic.title}</h1>
    {#if topic.description}<div class="md muted desc">{@html renderMarkdown(topic.description)}</div>{/if}
    <p class="status">
      {summary.total - summary.counts.new}/{summary.total} начато ·
      {summary.counts.review + summary.counts.mastered} закреплено ·
      {summary.open ? (summary.gate ? 'следующая порция открыта' : 'следующая порция — после закрепления текущей') : 'тема закрыта до освоения предыдущих'}
    </p>

    {#each Array.from({ length: Math.ceil(topic.cards.length / batch) }, (_, i) => orderedCards(topic).slice(i * batch, i * batch + batch)) as group, gi (gi)}
      <h2 class="section">Порция {gi + 1}</h2>
      <ul class="cards surface appear" style="animation-delay: {gi * 0.04}s">
        {#each group as card (card.id)}
          {@const stage = stageOf(card)}
          {@const skills = cardSkills(data, card)}
          <li>
            <a class="card" href="#/card/{topic.id}/{card.id}">
              <div class="word">
                <b>{card.content.en ?? card.content.title}</b>
                <span class="muted">{card.content.ru ?? card.content.formula ?? ''}</span>
              </div>
              <div class="skills" aria-label="Навыки">
                {#each skills as sk (sk)}
                  {@const r = retrievability(data.deck, sk, card.progress?.skills?.[sk], now)}
                  <i title="{sk}: {Math.round(r * 100)}%" style:--r={r}></i>
                {/each}
              </div>
              <span class="chip {stage}">{STAGE_LABEL[stage]}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</div>

<style>
  .back { display: inline-flex; margin: 22px 0 12px; font-size: 14px; text-decoration: none; color: var(--ink-3); }
  .back:hover { color: var(--ink); }
  .desc { max-width: 62ch; }
  .status { font-size: 13px; color: var(--ink-3); margin: 8px 0 0; }
  .cards { list-style: none; margin: 0; padding: 4px 0; overflow: hidden; }
  .cards li { padding-inline: 18px; }
  .cards li:hover { background: var(--soft); }
  .cards li + li .card { border-top: 1px solid var(--rule); }
  .card { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 14px; align-items: center; padding: 13px 0; text-decoration: none; }
  .word { display: grid; gap: 1px; min-width: 0; }
  .word b { font-weight: 500; }
  .word span { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skills { display: flex; gap: 3px; }
  .skills i { width: 5px; height: 16px; border-radius: 3px; background: linear-gradient(to top, var(--good) calc(var(--r) * 100%), var(--soft) 0); }
  @media (max-width: 520px) { .skills { display: none; } .card { grid-template-columns: minmax(0, 1fr) auto; } }
</style>
