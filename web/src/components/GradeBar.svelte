<script lang="ts">
  import type { Grade } from '../lib/types';

  interface Props { selected: Grade | null; auto?: Grade | null; intervals?: Record<Grade, string> | null; onpick: (g: Grade) => void }
  let { selected, auto = null, intervals = null, onpick }: Props = $props();

  const GRADES: { g: Grade; name: string; key: string }[] = [
    { g: 1, name: 'Заново', key: 'again' }, { g: 2, name: 'Трудно', key: 'hard' },
    { g: 3, name: 'Хорошо', key: 'good' }, { g: 4, name: 'Легко', key: 'easy' },
  ];
</script>

<div class="bar" role="radiogroup" aria-label="Насколько легко вспомнилось">
  {#each GRADES as { g, name, key } (g)}
    <button type="button" role="radio" aria-checked={selected === g} class="g {key}" class:on={selected === g} class:dim={selected !== null && selected !== g} onclick={() => onpick(g)}>
      {#if auto === g}<span class="auto" title="авто"></span>{/if}
      <span class="top num">{intervals ? intervals[g] : ''}</span>
      <span class="name">{name}</span>
      <span class="foot"><span class="bars" aria-hidden="true">{#each [1, 2, 3, 4] as k (k)}<i class:full={k <= g}></i>{/each}</span><span class="key num">{g}</span></span>
    </button>
  {/each}
</div>
<p class="keys" aria-hidden="true">← → выбрать · Enter или пробел — дальше</p>

<style>
  .bar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .g { --ink: var(--again); --soft: var(--again-bg); --deep: var(--again-deep); height: 72px; padding: 8px 6px; border: 1px solid var(--ink); border-radius: 12px; background: var(--soft); color: var(--ink); box-shadow: 0 2px 0 var(--ink); display: flex; flex-direction: column; align-items: center; justify-content: space-between; cursor: pointer; position: relative; transition: background-color 200ms var(--ease), color 200ms var(--ease), border-color 200ms var(--ease), transform 120ms var(--ease); }
  .g.hard { --ink: var(--hard); --soft: var(--hard-bg); --deep: var(--hard-deep); }
  .g.good { --ink: var(--good); --soft: var(--good-bg); --deep: var(--good-deep); }
  .g.easy { --ink: var(--easy); --soft: var(--easy-bg); --deep: var(--easy-deep); }
  .g:active { transform: translateY(2px); box-shadow: none; }
  .g.on { background: var(--ink); color: var(--on-grade); box-shadow: 0 2px 0 var(--deep); }
  .g.dim { background: var(--card); border-color: var(--line); box-shadow: 0 2px 0 var(--line); }
  .top { font: 400 11px/1 var(--font-mono); white-space: nowrap; }
  .name { font: 600 15px/1 var(--font-body); }
  .foot { display: flex; align-items: center; gap: 6px; }
  .bars { display: flex; gap: 2px; }
  .bars i { width: 7px; height: 3px; border-radius: 1px; background: var(--line); }
  .bars i.full { background: var(--ink); }
  .on .bars i { background: var(--deep); }
  .on .bars i.full { background: var(--on-grade); }
  .auto { position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--amber); }
  .key { font: 400 10px/1 var(--font-mono); }
  .keys { display: none; margin: 8px 0 0; text-align: center; font: 400 11px/1 var(--font-mono); color: var(--ink-3); }
  @media (hover: hover) and (pointer: fine) { .keys { display: block; } }
  @media (hover: none) { .key { display: none; } }
</style>
