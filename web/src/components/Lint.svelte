<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { lintDeck, type LintIssue } from '../lib/lint';

  let done = $state(0);
  let total = $state(0);
  let issues = $state<LintIssue[] | null>(null);
  let counts = $state({ exercises: 0, audio: 0 });
  const problems = $derived(issues?.filter((i) => !i.words) ?? []);
  const words = $derived(issues?.filter((i) => i.words && !i.options) ?? []);
  const options = $derived(issues?.filter((i) => i.options) ?? []);
  const base = $derived(app.data?.known ? 'тест на знание слов' : '1000 частых слов из placement.yaml');

  onMount(async () => {
    const res = await lintDeck(app.data!, (d, t) => { done = d; total = t; });
    issues = res.issues;
    counts = { exercises: res.exercises, audio: res.audio };
  });
</script>

<div class="narrow">
  <div class="eyebrow" style="margin-top:32px">Проверка колоды</div>
  <h1 class="display" data-lint-state={issues ? 'done' : 'running'}>
    {#if !issues}Проверяю… {done}/{total}{:else if problems.length}Найдено проблем: {problems.length}{:else}Всё в порядке{/if}
  </h1>
  {#if issues}
    <p class="muted mono summary">{counts.exercises} заданий отрендерено и решено эталонным ответом · {counts.audio} аудиофайлов на месте</p>
    {#snippet list(items: LintIssue[])}
      <ul class="issues">
        {#each items as issue, i (i)}
          <li class="panel">
            <a href="#/card/{issue.card.topic}/{issue.card.id}">{issue.card.topic}/{issue.card.id}{issue.exercise ? ` · ${issue.exercise.id}` : ''}</a>
            <span>{issue.message}</span>
          </li>
        {/each}
      </ul>
    {/snippet}
    {@render list(problems)}
    {#if words.length || options.length}
      <h2 class="words">Слова до карточки: {words.length}</h2>
      <p class="muted summary">Задания со словами, которых нет ни среди известных ({base}), ни в карточках раньше по порядку колоды, и клипы ниже порога понимания.</p>
      {@render list(words)}
      {#if options.length}
        <h3 class="options">Незнакомые слова в неверных вариантах: {options.length}</h3>
        <p class="muted summary">Настоящие слова среди неверных вариантов и лишних фишек, которых ученик ещё не встречал и которых нет в колоде. Задание они не блокируют (там бывают нарочные ошибки вроде goed), но сбивают. Узнаваемые ошибки в известных словах (goed, shoutting, childs, studing) сюда не попадают.</p>
        {@render list(options)}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .summary { font-size: 13px; }
  .words { font-size: 18px; margin: 24px 0 4px; }
  .options { font-size: 15px; margin: 20px 0 4px; }
  .issues { list-style: none; padding: 0; display: grid; gap: 6px; }
  .issues li { padding: 10px 12px; display: grid; gap: 2px; font-size: 14px; }
  .issues a { font-family: var(--font-mono); font-size: 12px; }
</style>
