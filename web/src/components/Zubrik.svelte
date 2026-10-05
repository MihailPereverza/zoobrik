<script lang="ts">
  import { onDestroy } from 'svelte';
  import { zubrikSvg, type Mood } from '../lib/mascot';
  import { app } from '../lib/state.svelte';

  interface Props { mood?: Mood; size?: number; crop?: 'full' | 'head'; still?: boolean; phase?: number; onpoke?: () => void; label?: string }
  let { mood = 'hello', size = 200, crop = 'full', still = false, phase = 0, onpoke, label = 'Зубрик' }: Props = $props();

  let pokes = $state(0);
  let poking = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(timer));

  const svg = $derived(zubrikSvg({ mood, size, crop, phase, still: still || !app.mascotMotion, poke: poking ? pokes : 0 }));

  function poke() {
    clearTimeout(timer);
    pokes += 1;
    poking = true;
    timer = setTimeout(() => (poking = false), 460);
    onpoke?.();
  }
</script>

{#if onpoke}
  <button class="zubrik" type="button" aria-label={label} style:width="{size}px" style:height="{size}px" onclick={poke}>{@html svg}</button>
{:else}
  <span class="zubrik" role="img" aria-label={label} style:width="{size}px" style:height="{size}px">{@html svg}</span>
{/if}

<style>
  .zubrik { display: block; padding: 0; margin: 0; border: 0; background: none; flex: none; }
  button.zubrik { cursor: pointer; }
</style>
