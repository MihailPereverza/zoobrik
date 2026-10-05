<script lang="ts">
  import { onMount } from 'svelte';
  import { app, backend } from '../lib/state.svelte';
  import { forecast, STAGE_LABEL, stageOf } from '../lib/summary';
  import type { Skill, Stage } from '../lib/types';

  const data = $derived(app.data!);
  const now = $derived.by(() => { void app.version; return new Date(); });
  let activity = $state<Record<string, number>>({});
  onMount(() => { backend().activity().then((a) => (activity = a)).catch(() => {}); });

  const cards = $derived(data.topics.flatMap((t) => t.cards));
  const stages = $derived.by(() => {
    const counts: Record<Stage, number> = { new: 0, learning: 0, review: 0, mastered: 0, suspended: 0 };
    cards.forEach((c) => (counts[stageOf(c)] += 1));
    return counts;
  });
  const days = $derived(forecast(data, now, 14));
  const maxDay = $derived(Math.max(1, ...days));
  const skillAccuracy = $derived.by(() => {
    const acc: Partial<Record<Skill, { ok: number; all: number }>> = {};
    for (const card of cards) {
      for (const line of card.progress?.recent ?? []) {
        const [, , skills, grade] = line.split(' ');
        for (const s of (skills ?? '').split(',') as Skill[]) {
          if (!s) continue;
          acc[s] ??= { ok: 0, all: 0 };
          acc[s]!.all += 1;
          if (!grade.endsWith('1')) acc[s]!.ok += 1;
        }
      }
    }
    return Object.entries(acc) as [Skill, { ok: number; all: number }][];
  });
  const weeks = $derived.by(() => {
    const end = new Date(now); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(start.getDate() - 7 * 17 - end.getDay());
    const cells = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      cells.push({ key, n: activity[key] ?? 0 });
    }
    return cells;
  });
  const level = (n: number) => (n === 0 ? 0 : n < 20 ? 1 : n < 60 ? 2 : n < 150 ? 3 : 4);
  const totalAnswers = $derived(Object.values(activity).reduce((a, b) => a + b, 0));
  const dayLabel = (i: number) => { const d = new Date(now); d.setDate(d.getDate() + i); return i === 0 ? 'сег' : String(d.getDate()); };
</script>

<div class="wrap">
  <div class="eyebrow" style="margin-top:32px">Статистика</div>
  <h1 class="display">{cards.filter((c) => stageOf(c) !== 'new').length} из {cards.length} карточек в работе</h1>

  <div class="grid">
    <section class="panel box">
      <h2>Стадии</h2>
      <ul class="stages">
        {#each Object.entries(stages) as [stage, n] (stage)}
          <li><span class="chip {stage}">{STAGE_LABEL[stage as Stage]}</span><span class="mono">{n}</span></li>
        {/each}
      </ul>
    </section>

    <section class="panel box">
      <h2>Прогноз на 14 дней</h2>
      <div class="bars">
        {#each days as n, i (i)}
          <div class="col" title="{n} карточек"><span class="mono v">{n || ''}</span><i style:height="{(n / maxDay) * 100}%"></i><span class="mono d">{dayLabel(i)}</span></div>
        {/each}
      </div>
    </section>

    <section class="panel box">
      <h2>Точность по навыкам <small class="muted">последние ответы</small></h2>
      {#if skillAccuracy.length}
        <ul class="acc">
          {#each skillAccuracy as [s, v] (s)}
            <li><span>{s}</span><div class="meter"><i style:width="{(v.ok / v.all) * 100}%"></i></div><span class="mono">{Math.round((v.ok / v.all) * 100)}%</span></li>
          {/each}
        </ul>
      {:else}<p class="muted">Появится после первых ответов.</p>{/if}
    </section>

    <section class="panel box wide">
      <h2>Занятия <small class="muted mono">{totalAnswers} ответов</small></h2>
      <div class="heat">
        {#each weeks as c (c.key)}<i class="l{level(c.n)}" title="{c.key}: {c.n}"></i>{/each}
      </div>
    </section>
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 18px; }
  .box { padding: 16px 18px; min-width: 0; }
  .wide { grid-column: 1 / -1; }
  h2 { font: 600 15px/1.3 var(--font-body); margin: 0 0 14px; }
  h2 small { font-weight: 400; font-size: 12px; margin-left: 6px; }
  .stages { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .stages li { display: flex; justify-content: space-between; align-items: center; }
  .bars { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; height: 140px; align-items: end; }
  .col { display: grid; grid-template-rows: 16px 1fr 16px; height: 100%; align-items: end; text-align: center; }
  .col i { display: block; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; }
  .col .v, .col .d { font-size: 10px; color: var(--ink-3); }
  .acc { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .acc li { display: grid; grid-template-columns: 80px 1fr 44px; gap: 10px; align-items: center; font-size: 14px; }
  .meter { height: 8px; background: var(--soft); border-radius: 4px; overflow: hidden; }
  .meter i { display: block; height: 100%; background: var(--good); }
  .heat { display: grid; grid-template-rows: repeat(7, 13px); grid-auto-flow: column; grid-auto-columns: 13px; gap: 3px; overflow-x: auto; padding-bottom: 4px; }
  .heat i { border-radius: 3px; background: var(--soft); }
  .heat .l1 { background: color-mix(in srgb, var(--good) 30%, var(--soft)); }
  .heat .l2 { background: color-mix(in srgb, var(--good) 55%, var(--soft)); }
  .heat .l3 { background: color-mix(in srgb, var(--good) 80%, var(--soft)); }
  .heat .l4 { background: var(--good); }
</style>
