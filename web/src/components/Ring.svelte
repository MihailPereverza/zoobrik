<script lang="ts">
  let { value, max, size = 92, label = '' }: { value: number; max: number; size?: number; label?: string } = $props();
  const r = 40;
  const c = 2 * Math.PI * r;
  const pct = $derived(Math.min(1, value / Math.max(1, max)));
</script>

<div class="ring" style:width="{size}px" style:height="{size}px" role="img" aria-label="{value} из {max}{label ? ` ${label}` : ''}">
  <svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r={r} class="track" />
    <circle cx="50" cy="50" r={r} class="bar" class:done={pct >= 1} stroke-dasharray={c} stroke-dashoffset={c * (1 - pct)} />
  </svg>
  <div class="center num"><b>{value}</b><span>из {max}</span></div>
</div>

<style>
  .ring { position: relative; flex: none; }
  svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  circle { fill: none; stroke-width: 8; }
  .track { stroke: var(--soft); }
  .bar { stroke: var(--ink-2); stroke-linecap: round; transition: stroke-dashoffset .9s var(--ease); }
  .bar.done { stroke: var(--good); }
  .center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
  b { font-size: 22px; font-weight: 600; }
  span { font-size: 11px; color: var(--ink-3); }
</style>
