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
    <a class="back muted" href="#/">← Все темы</a>
    <div class="eyebrow">{topic.kind === 'grammar' ? 'Грамматика' : 'Слова'}{topic.level ? ` · ${topic.level}` : ''} · порции по {batch}</div>
    <h1 class="display">{topic.title}</h1>
    {#if topic.description}<div class="md muted desc">{@html renderMarkdown(topic.description)}</div>{/if}
    <p class="status mono">
      {summary.total - summary.counts.new}/{summary.total} начато ·
      {summary.counts.review + summary.counts.mastered} закреплено ·
      {summary.open ? (summary.gate ? 'следующая порция открыта' : 'следующая порция — после закрепления текущей') : 'тема закрыта до освоения предыдущих'}
    </p>

    <div class="cards">
      {#each orderedCards(topic) as card, i (card.id)}
        {@const stage = stageOf(card)}
        {@const skills = cardSkills(data, card)}
        {#if i % batch === 0}<div class="batch eyebrow">Порция {i / batch + 1}</div>{/if}
        <a class="card panel" href="#/card/{topic.id}/{card.id}">
          <div class="word">
            <b>{card.content.en ?? card.content.title}</b>
            <span class="muted">{card.content.ru ?? card.content.formula ?? ''}</span>
          </div>
          <div class="skills" aria-label="Навыки">
            {#each skills as s (s)}
              {@const r = retrievability(data.deck, s, card.progress?.skills?.[s], now)}
              <i title="{s}: {Math.round(r * 100)}%" style:--r={r}></i>
            {/each}
          </div>
          <span class="chip {stage}">{STAGE_LABEL[stage]}</span>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .back { display: inline-block; margin: 24px 0 14px; font-size: 14px; text-decoration: none; }
  .desc { max-width: 62ch; }
  .status { font-size: 12px; color: var(--ink-3); margin: 12px 0 22px; }
  .cards { display: grid; gap: 6px; }
  .batch { margin: 14px 0 2px; }
  .card { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 16px; align-items: center; padding: 11px 14px; text-decoration: none; }
  .card:hover { border-color: var(--rule-strong); }
  .word { display: flex; gap: 12px; align-items: baseline; min-width: 0; flex-wrap: wrap; }
  .word b { font-weight: 600; }
  .word span { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .skills { display: flex; gap: 3px; }
  .skills i { width: 8px; height: 18px; border-radius: 2px; background: linear-gradient(to top, var(--good) calc(var(--r) * 100%), var(--soft) 0); border: 1px solid var(--rule); }
  @media (max-width: 520px) { .skills { display: none; } .card { grid-template-columns: minmax(0, 1fr) auto; } }
</style>
