<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { log } from '../lib/log';

  // Display-only templates (card back) render into the page through Shadow DOM: styles stay isolated,
  // and taps are handled by the app itself, so audio starts synchronously on every browser.
  let { html, css, onplay }: { html: string; css: string; onplay: (src: string, rate: number) => void } = $props();
  let host: HTMLDivElement;
  let root: ShadowRoot;

  function scopedCss(source: string): string {
    return source
      .replace(/:root\[data-theme="([a-z]+)"\]/g, ':host([data-theme="$1"])')
      .replace(/:root/g, ':host')
      .replace(/(^|\})\s*html, body\s*\{/g, '$1 :host, .zb-root {');
  }

  function sanitize(markup: string): string {
    return markup.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  }

  onMount(() => {
    root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', (event) => {
      const button = (event.target as Element).closest?.('[data-zb="play"]') as HTMLElement | null;
      if (!button?.dataset.src) return;
      log('back', 'play tapped', button.dataset.src.split('/deck/').pop());
      onplay(button.dataset.src, parseFloat(button.dataset.rate || '1'));
    });
  });

  $effect(() => {
    if (!root) return;
    root.innerHTML = `<style>${scopedCss(css)}\n:host, .zb-root { background: transparent !important; padding: 0 !important; }</style><div class="zb-root">${sanitize(html)}</div>`;
  });
</script>

<div class="inline-view" bind:this={host} data-theme={app.effectiveTheme}></div>

<style>
  .inline-view { display: block; }
</style>
