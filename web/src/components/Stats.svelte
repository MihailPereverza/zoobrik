<script lang="ts">
  import { onMount } from 'svelte';
  import { app, backend, reload } from '../lib/state.svelte';
  import { log } from '../lib/log';
  import type { OptimizeResult } from '../lib/optimizer';
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
  const leeches = $derived(cards.filter((c) => c.progress?.leech));
  const suspended = $derived(cards.filter((c) => c.progress?.stage === 'suspended'));
  const customParams = $derived(Boolean(data.deck.fsrs?.params?.length));

  let optimizing = $state(false);
  let optResult = $state<(OptimizeResult & { ms: number }) | null>(null);
  let optError = $state('');
  let optSaved = $state('');

  async function runOptimizer() {
    optimizing = true; optError = ''; optSaved = ''; optResult = null;
    try {
      const lines = await backend().journal();
      log('optimizer', 'start', { lines: lines.length });
      const worker = new Worker(new URL('../lib/optimizer.worker.ts', import.meta.url), { type: 'module' });
      const reply = await new Promise<any>((resolve) => { worker.onmessage = (e) => resolve(e.data); worker.onerror = (e) => resolve({ ok: false, error: e.message }); worker.postMessage({ lines, params: data.deck.fsrs?.params ?? null }); });
      worker.terminate();
      if (!reply.ok) throw new Error(reply.error);
      optResult = { ...reply.result, ms: reply.ms };
      log('optimizer', 'done', { adopted: reply.result.adopted, before: reply.result.before, after: reply.result.after, ms: reply.ms });
    } catch (e) { optError = (e as Error).message; log('optimizer', 'failed', optError); }
    optimizing = false;
  }

  async function applyParams(params: number[] | null) {
    await backend().saveParams(params);
    await reload();
    optSaved = params ? 'Параметры применены: новые интервалы считаются по ним.' : 'Вернул стандартные параметры FSRS.';
    optResult = null;
  }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

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
      <h2>Оптимизация FSRS <small class="muted">{customParams ? 'свои параметры' : 'стандартные параметры'}</small></h2>
      <p class="muted text">Подбирает 21 параметр модели памяти под вашу историю ответов — как кнопка «Optimize» в Anki. Чем больше повторений, тем точнее; хватит пары недель занятий.</p>
      <div class="row-btns">
        <button class="btn small" type="button" onclick={runOptimizer} disabled={optimizing}>{optimizing ? 'Считаю…' : 'Оптимизировать'}</button>
        {#if customParams}<button class="btn small ghost" type="button" onclick={() => applyParams(null)}>Сбросить к стандартным</button>{/if}
      </div>
      {#if optError}<p class="bad text">{optError}</p>{/if}
      {#if optSaved}<p class="text">{optSaved}</p>{/if}
      {#if optResult && optResult.reviews === 0}
        <p class="muted text">В журнале пока нет ответов для обучения. Позанимайтесь несколько дней — оптимизатору нужны повторения через день и больше.</p>
      {:else if optResult}
        <div class="opt num">
          <div><b>{optResult.reviews}</b><span>ответов в истории</span></div>
          <div><b>{optResult.items}</b><span>примеров для обучения</span></div>
          <div><b>{pct(optResult.before.rmse)} → {pct(optResult.after.rmse)}</b><span>ошибка предсказания (RMSE)</span></div>
          <div><b>{optResult.before.logLoss.toFixed(3)} → {optResult.after.logLoss.toFixed(3)}</b><span>log-loss</span></div>
        </div>
        {#if optResult.adopted}
          <button class="btn small" type="button" onclick={() => applyParams(optResult!.params)}>Применить новые параметры</button>
        {:else}<p class="muted text">{optResult.reason}</p>{/if}
      {/if}
    </section>

    <section class="panel box">
      <h2>Пиявки <small class="muted">{leeches.length}</small></h2>
      {#if leeches.length}
        <ul class="plain">{#each leeches as c (c.id)}<li><a href="#/card/{c.topic}/{c.id}">{c.content.term ?? c.content.title}</a><span class="muted">{c.content.meaning ?? ''}</span></li>{/each}</ul>
      {:else}<p class="muted text">Нет. Слово становится пиявкой после {data.deck.fsrs?.leech_threshold ?? 8} провалов одного навыка.</p>{/if}
    </section>

    <section class="panel box">
      <h2>Приостановлены <small class="muted">{suspended.length}</small></h2>
      {#if suspended.length}
        <ul class="plain">{#each suspended as c (c.id)}<li><a href="#/card/{c.topic}/{c.id}">{c.content.term ?? c.content.title}</a><span class="muted">{c.content.meaning ?? ''}</span></li>{/each}</ul>
      {:else}<p class="muted text">Нет приостановленных карточек.</p>{/if}
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
  .text { font-size: 14px; margin: 0 0 12px; }
  .bad { color: var(--again); }
  .row-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .opt { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 6px 0 14px; padding: 12px; background: var(--soft); border-radius: 12px; }
  .opt div { display: grid; gap: 2px; }
  .opt b { font-size: 16px; font-weight: 600; }
  .opt span { font-size: 12px; color: var(--ink-3); }
  .plain { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .plain li { display: flex; gap: 10px; align-items: baseline; font-size: 14px; }
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
