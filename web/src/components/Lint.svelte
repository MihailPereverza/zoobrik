<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { lintDeck, type LintIssue } from '../lib/lint';

  let done = $state(0);
  let total = $state(0);
  let issues = $state<LintIssue[] | null>(null);
  let counts = $state({ exercises: 0, audio: 0 });

  onMount(async () => {
    const res = await lintDeck(app.data!, (d, t) => { done = d; total = t; });
    issues = res.issues;
    counts = { exercises: res.exercises, audio: res.audio };
  });
</script>

<div class="narrow">
  <div class="eyebrow" style="margin-top:32px">Проверка колоды</div>
  <h1 class="display" data-lint-state={issues ? 'done' : 'running'}>
    {#if !issues}Проверяю… {done}/{total}{:else if issues.length}Найдено проблем: {issues.length}{:else}Всё в порядке{/if}
  </h1>
  {#if issues}
    <p class="muted mono summary">{counts.exercises} заданий отрендерено и решено эталонным ответом · {counts.audio} аудиофайлов на месте</p>
    <ul class="issues">
      {#each issues as issue, i (i)}
        <li class="panel">
          <a href="#/card/{issue.card.topic}/{issue.card.id}">{issue.card.topic}/{issue.card.id}{issue.exercise ? ` · ${issue.exercise.id}` : ''}</a>
          <span>{issue.message}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .summary { font-size: 13px; }
  .issues { list-style: none; padding: 0; display: grid; gap: 6px; }
  .issues li { padding: 10px 12px; display: grid; gap: 2px; font-size: 14px; }
  .issues a { font-family: var(--font-mono); font-size: 12px; }
</style>
