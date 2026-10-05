<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';

  interface Props {
    srcdoc: string;
    onevent: (type: string, data: any) => void;
  }
  let { srcdoc, onevent }: Props = $props();
  let iframe: HTMLIFrameElement;
  let height = $state(280);

  export function send(message: Record<string, unknown>) {
    iframe?.contentWindow?.postMessage({ zb: 1, ...message }, '*');
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
      if (type === 'resize') { height = Math.max(160, data.height); return; }
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
  onload={() => focus()}
></iframe>

<style>
  iframe { display: block; width: 100%; border: 0; background: transparent; }
</style>
