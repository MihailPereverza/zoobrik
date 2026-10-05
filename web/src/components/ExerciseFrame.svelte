<script lang="ts">
  import { onMount } from 'svelte';
  import { app, backend } from '../lib/state.svelte';
  import { log, mediaName } from '../lib/log';

  interface Props {
    srcdoc: string;
    onevent: (type: string, data: any) => void;
    autofocus?: boolean;
    name?: string;
  }
  let { srcdoc, onevent, autofocus = true, name = 'frame' }: Props = $props();
  let iframe: HTMLIFrameElement;
  let height = $state(280);
  let shown = $state(false);

  export function send(message: Record<string, unknown>) {
    iframe?.contentWindow?.postMessage({ zb: 1, ...message }, '*');
  }

  // Send each file as soon as it is ready: one slow download must not hold back audio that is already cached.
  function deliverMedia(urls: string[]) {
    for (const url of urls) {
      const started = performance.now();
      backend().media(url)
        .then((local) => fetch(local))
        .then(async (res) => {
          const buffer = await res.arrayBuffer();
          if (!iframe?.contentWindow) { log(name, 'frame gone before media arrived', mediaName(url)); return; }
          const bytes = buffer.byteLength;
          iframe.contentWindow.postMessage({ zb: 1, type: 'media', files: [{ url, type: res.headers.get('content-type') ?? 'audio/mpeg', buffer }] }, '*', [buffer]);
          log(name, 'media sent', { src: mediaName(url), bytes, ms: Math.round(performance.now() - started) });
        })
        .catch((error) => log(name, 'media failed', { src: mediaName(url), error: String(error?.message ?? error) }));
    }
  }

  export function focus() {
    iframe?.focus();
    send({ type: 'focus' });
  }

  $effect(() => { send({ type: 'theme', theme: app.effectiveTheme }); });

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe?.contentWindow || !event.data?.zb) return;
      const { type, ...data } = event.data;
      if (type === 'resize') { height = Math.max(120, data.height); shown = true; return; }
      if (type === 'need-media') { deliverMedia(data.urls ?? []); return; }
      if (type === 'log') { log(`${name}:inside`, data.msg, data.data); return; }
      onevent(type, data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
</script>

<iframe
  bind:this={iframe}
  {srcdoc}
  sandbox="allow-scripts"
  title="Задание"
  style:height="{height}px"
  class:shown
  onload={() => { send({ type: 'theme', theme: app.effectiveTheme }); if (autofocus) focus(); }}
></iframe>

<style>
  iframe { display: block; width: 100%; border: 0; background: var(--paper); color-scheme: inherit; visibility: hidden; transition: height .25s var(--ease); }
  iframe.shown { visibility: visible; }
</style>
