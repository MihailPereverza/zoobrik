<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { log } from '../lib/log';
  import { glossary, lookupGloss } from '../lib/gloss';
  import { canMarkKnown, markKnown } from '../lib/known';

  // Display-only templates (card back) render into the page through Shadow DOM: styles stay isolated,
  // and taps are handled by the app itself, so audio starts synchronously on every browser.
  let { html, css, onplay }: { html: string; css: string; onplay: (src: string, rate: number) => void } = $props();
  let host: HTMLDivElement;
  let root: ShadowRoot;
  let tipWords: string[] = [];

  function scopedCss(source: string): string {
    return source
      .replace(/:root\[data-theme="([a-z]+)"\]/g, ':host([data-theme="$1"])')
      .replace(/:root/g, ':host')
      .replace(/(^|\})\s*html, body\s*\{/g, '$1 :host, .zb-root {');
  }

  function sanitize(markup: string): string {
    return markup.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  }

  // Same tap-to-translate as inside exercise frames, done by the app because the back is not an iframe.
  function wrapWords(node: Node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('style,script,svg,[data-w]') || !/[A-Za-z]/.test(n.textContent ?? '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const n of nodes) {
      const holder = document.createElement('span');
      holder.innerHTML = (n.textContent ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
        .replace(/[A-Za-z][A-Za-z'\u2019]*(?:-[A-Za-z]+)*/g, '<span data-w>$&</span>');
      n.replaceWith(...holder.childNodes);
    }
  }

  function hideTip() {
    root.querySelector('.zb-gloss')?.remove();
    root.querySelectorAll('.zb-glossed').forEach((w) => w.classList.remove('zb-glossed'));
  }

  function showGloss(word: HTMLElement) {
    hideTip();
    const block = word.closest('p,li,td,th,h1,h2,h3,div') ?? root;
    const list = [...block.querySelectorAll<HTMLElement>('[data-w]')];
    const found = app.data ? lookupGloss(glossary(app.data), list.map((w) => w.textContent ?? ''), list.indexOf(word)) : null;
    log('back', 'gloss', { word: word.textContent, found: found?.phrase ?? null });
    tipWords = found ? list.slice(found.start, found.start + found.length).map((w) => w.textContent ?? '') : [word.textContent ?? ''];
    const canKnow = canMarkKnown(tipWords);
    const tip = document.createElement('div');
    tip.className = `zb-gloss${found ? '' : ' none'}${canKnow ? ' can-know' : ''}`;
    tip.innerHTML = '<b></b><span></span>';
    tip.firstElementChild!.textContent = found?.phrase ?? word.textContent;
    tip.lastElementChild!.textContent = found?.ru ?? 'нет в словаре колоды';
    if (canKnow) tip.insertAdjacentHTML('beforeend', '<button type="button" class="zb-known" data-zb-known>знаю</button>');
    root.querySelector('.zb-root')!.appendChild(tip);
    if (found) list.slice(found.start, found.start + found.length).forEach((w) => w.classList.add('zb-glossed'));
    const box = host.getBoundingClientRect(), r = word.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left - box.left + r.width / 2 - tip.offsetWidth / 2), box.width - tip.offsetWidth);
    const above = r.top - box.top - tip.offsetHeight - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${above < 0 ? r.bottom - box.top + 8 : above}px`;
  }

  onMount(() => {
    root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', (event) => {
      if ((event.target as Element).closest?.('[data-zb-known]')) { hideTip(); markKnown(tipWords).catch((e) => log('back', 'known failed', String(e?.message ?? e))); return; }
      const word = (event.target as Element).closest?.('[data-w]') as HTMLElement | null;
      const button = (event.target as Element).closest?.('[data-zb="play"]') as HTMLElement | null;
      if (word && !button) { showGloss(word); return; }
      hideTip();
      if (!button?.dataset.src) return;
      log('back', 'play tapped', button.dataset.src.split('/deck/').pop());
      onplay(button.dataset.src, parseFloat(button.dataset.rate || '1'));
    });
  });

  $effect(() => {
    if (!root) return;
    root.innerHTML = `<style>${scopedCss(css)}\n:host, .zb-root { background: transparent !important; padding: 0 !important; }\n.zb-root { position: relative; }</style><div class="zb-root">${sanitize(html)}</div>`;
    wrapWords(root.querySelector('.zb-root')!);
  });
</script>

<div class="inline-view" bind:this={host} data-theme={app.effectiveTheme}></div>

<style>
  .inline-view { display: block; }
</style>
