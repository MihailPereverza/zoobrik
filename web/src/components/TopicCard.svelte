<script lang="ts">
  import Zubrik from './Zubrik.svelte';
  import { app } from '../lib/state.svelte';
  import { formatInterval } from '../lib/fsrs';
  import { plural } from '../lib/activity';
  import { nextDueDate } from '../lib/scheduler';
  import type { TopicSummary } from '../lib/summary';

  let { t, delay = 0, titleOf }: { t: TopicSummary; delay?: number; titleOf: (id: string) => string } = $props();
  const started = $derived(t.total - t.counts.new);
  const batch = $derived(t.topic.batch ?? 4);
  const portion = $derived(Math.max(1, Math.ceil(started / batch)));
  const portions = $derived(Math.max(1, Math.ceil(t.total / batch)));
  const resting = $derived(t.open && started > 0 && t.due === 0);
  const next = $derived.by(() => {
    if (!resting || !app.data) return '';
    const d = nextDueDate({ ...app.data, topics: [t.topic] }, new Date());
    return d ? `следующее через ${formatInterval(new Date(), d)}` : '';
  });
  const pct = $derived(`${((t.counts.review + t.counts.mastered + t.counts.learning * 0.5) / Math.max(1, t.total)) * 100}%`);
</script>

<a href="#/topic/{t.topic.id}" class="card zb-a" class:locked={!t.open} class:resting style="animation: zb-rise 320ms {delay}ms var(--ease-out) both">
  {#if resting}
    <span class="avatar">{#if app.mascotMode !== 'off'}<Zubrik mood="sleep" size={38} crop="head" />{/if}</span>
    <div class="col">
      <b>{t.topic.title}</b>
      <span class="meta">Всё повторено{next ? ` · ${next}` : ''}</span>
    </div>
    {#if t.topic.level}<span class="lvl">{t.topic.level}</span>{/if}
  {:else}
    <div class="row">
      <b>{t.topic.title}</b>
      {#if t.topic.level}<span class="lvl">{t.topic.level}</span>{/if}
    </div>
    <div class="bar"><span style:width={pct}></span></div>
    <div class="meta-row">
      {#if !t.open}<span>После «{(t.topic.requires ?? []).map(titleOf).join('», «')}»</span>
      {:else if t.due}<span>{t.due} к повторению</span>
      {:else if started === 0}<span>{t.total} {plural(t.total, 'слово', 'слова', 'слов')} · ещё не начата</span>
      {:else}<span>{started} из {t.total} начато</span>{/if}
      <span class="muted">{t.topic.kind === 'grammar' ? 'правило' : `порция ${portion} из ${portions}`}</span>
    </div>
  {/if}
</a>

<style>
  .card { text-decoration: none; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; transition: transform 120ms var(--ease), border-color 200ms var(--ease); }
  .card:hover { border-color: var(--rule-strong); }
  .card:active { transform: translateY(1px); }
  .card.resting { flex-direction: row; align-items: center; gap: 12px; padding: 12px 16px 12px 12px; }
  .card.locked b { color: var(--ink-3); }
  .row { display: flex; align-items: center; gap: 8px; }
  .row b, .col b { flex: 1; font-size: 16px; font-weight: 600; }
  .col { flex: 1; display: grid; gap: 2px; }
  .lvl { height: 22px; padding: 0 7px; border-radius: 6px; background: var(--soft); font: 400 12px/1 var(--font-mono); color: var(--ink-2); display: inline-flex; align-items: center; }
  .bar { height: 4px; border-radius: 2px; background: var(--soft); overflow: hidden; display: flex; }
  .bar span { background: var(--brand); border-radius: 2px; transition: width .6s var(--ease); }
  .meta-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--ink-2); }
  .meta { font-size: 13px; color: var(--ink-2); }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--soft); overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
</style>
