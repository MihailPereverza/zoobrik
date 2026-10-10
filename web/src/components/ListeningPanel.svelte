<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { app, backend } from '../lib/state.svelte';
  import { mediaUrl } from '../lib/render';
  import { glossary, lookupGloss, type Gloss } from '../lib/gloss';
  import { log } from '../lib/log';
  import { canMarkKnown, markKnown } from '../lib/known';
  import type { Card } from '../lib/types';

  // The clip stays in the app (not in the exercise frame) so it keeps playing between the questions of one card.
  let { card, onpeek }: { card: Card; onpeek?: () => void } = $props();
  const clip = $derived(card.listening!);
  const isVideo = $derived(/\.(mp4|webm|m4v|mov)$/i.test(clip.media));

  let player = $state<HTMLMediaElement>();
  let src = $state('');
  let failed = $state('');
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let slow = $state(false);
  let showText = $state(false);
  let peeked = false;
  let box = $state<HTMLDivElement>();
  let tip = $state<(Gloss & { x: number; y: number }) | null>(null);
  let missing = $state<{ word: string; x: number; y: number } | null>(null);
  let tipWords = $state<string[]>([]);
  const canKnow = $derived.by(() => { void app.data?.known; return canMarkKnown(tipWords); });
  let frame = 0;

  onMount(async () => {
    try { src = await backend().media(mediaUrl(card, clip.media)); } catch (error) { failed = 'Отрывок ещё не загружен — нужна сеть.'; log('listening', 'media failed', String((error as Error).message)); }
  });
  onDestroy(() => { cancelAnimationFrame(frame); player?.pause(); });

  // timeupdate fires ~4 times a second; a frame loop keeps the highlighted word in step with speech.
  function follow() {
    if (player) time = player.currentTime;
    if (playing) frame = requestAnimationFrame(follow);
  }

  function toggle() {
    if (!player) return;
    if (player.paused) { player.play().catch((e) => log('listening', 'play failed', String(e?.message))); } else player.pause();
  }

  function seek(to: number, play = true) {
    if (!player) return;
    player.currentTime = Math.max(0, to);
    time = player.currentTime;
    if (play && player.paused) player.play().catch(() => {});
  }

  function setSlow() {
    slow = !slow;
    if (player) player.playbackRate = slow ? 0.75 : 1;
  }

  const current = $derived(clip.segments.findIndex((s) => time >= s.start && time < s.end));
  const lastStarted = $derived.by(() => {
    let found = 0;
    clip.segments.forEach((s, i) => { if (s.start <= time) found = i; });
    return found;
  });

  function replayLine() {
    const seg = clip.segments[current >= 0 ? current : lastStarted];
    if (seg) seek(seg.start);
  }

  async function toggleText() {
    showText = !showText;
    if (showText && !peeked) { peeked = true; onpeek?.(); log('listening', 'transcript opened', card.id); }
    await tick();
    scrollToCurrent();
  }

  function scrollToCurrent() {
    const el = box?.querySelector<HTMLElement>('.seg.now');
    if (el && box) box.scrollTo({ top: el.offsetTop - box.clientHeight / 3, behavior: 'smooth' });
  }

  $effect(() => { if (showText && current >= 0) { void current; tick().then(scrollToCurrent); } });

  function gloss(event: MouseEvent, segIndex: number, wordIndex: number) {
    const words = clip.segments[segIndex].words.map((w) => w[0]);
    const found = app.data ? lookupGloss(glossary(app.data), words, wordIndex) : null;
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const host = box!.getBoundingClientRect();
    const x = target.left - host.left + target.width / 2;
    const y = target.top - host.top + box!.scrollTop;
    tip = found ? { ...found, x, y } : null;
    missing = found ? null : { word: words[wordIndex], x, y };
    glossSeg = segIndex;
    tipWords = found ? words.slice(found.start, found.start + found.length) : [words[wordIndex]];
  }

  function know() {
    const words = tipWords;
    tip = null; missing = null; tipWords = [];
    markKnown(words).catch((e) => log('listening', 'known failed', String(e?.message ?? e)));
  }
  let glossSeg = $state(-1);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<section class="listen surface">
  {#if failed}<p class="err">{failed}</p>{/if}
  {#if src}
    {#if isVideo}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={player} {src} playsinline preload="auto" poster={clip.poster ? mediaUrl(card, clip.poster) : undefined}
        onplay={() => { playing = true; follow(); }} onpause={() => (playing = false)} onended={() => (playing = false)}
        onloadedmetadata={() => (duration = player?.duration ?? 0)} onclick={toggle}></video>
    {:else}
      <audio bind:this={player} {src} preload="auto" onplay={() => { playing = true; follow(); }} onpause={() => (playing = false)} onended={() => (playing = false)}
        onloadedmetadata={() => (duration = player?.duration ?? 0)}></audio>
    {/if}
  {/if}

  <div class="bar">
    <button class="play" type="button" onclick={toggle} aria-label={playing ? 'Пауза' : 'Слушать'} disabled={!src}>
      {#if playing}<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></svg>{:else}<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" /></svg>{/if}
    </button>
    <input class="seek" type="range" min="0" max={duration || clip.duration || 1} step="0.1" value={time} oninput={(e) => seek(Number((e.currentTarget as HTMLInputElement).value), false)} aria-label="Позиция" />
    <span class="time num">{fmt(time)} / {fmt(duration || clip.duration || 0)}</span>
  </div>
  <div class="tools">
    <button type="button" class="tool" onclick={() => seek(time - 5)} disabled={!src}>−5 с</button>
    <button type="button" class="tool" onclick={replayLine} disabled={!src}>Повторить фразу</button>
    <button type="button" class="tool num" class:on={slow} onclick={setSlow}>0.75×</button>
    <button type="button" class="tool" class:on={showText} onclick={toggleText} aria-expanded={showText}>{showText ? 'Скрыть текст' : 'Текст'}</button>
  </div>

  {#if showText}
    <div class="text" bind:this={box}>
      {#each clip.segments as seg, si (si)}
        <p class="seg" class:now={si === current}>
          <button type="button" class="at num" onclick={() => seek(seg.start)} aria-label="Слушать с {fmt(seg.start)}">{fmt(seg.start)}</button>
          {#if seg.speaker}<b class="who">{seg.speaker}:</b>{/if}
          {#each seg.words as w, wi (wi)}<span class="w" class:said={si === current && time >= w[1]} class:spoken={si === current && time >= w[1] && time < w[2]}
              class:glossed={tip && glossSeg === si && wi >= tip.start && wi < tip.start + tip.length}
              role="button" tabindex="-1" onclick={(e) => gloss(e, si, wi)} onkeydown={() => {}}>{w[0]}</span>{' '}{/each}
        </p>
      {/each}
      {#if tip}<div class="tip" class:can-know={canKnow} style:left="{tip.x}px" style:top="{tip.y}px"><b>{tip.phrase}</b><span>{tip.ru}</span>{#if canKnow}<button type="button" class="known" onclick={know}>знаю</button>{/if}</div>{/if}
      {#if missing}<div class="tip none" class:can-know={canKnow} style:left="{missing.x}px" style:top="{missing.y}px"><b>{missing.word}</b><span>нет в словаре колоды</span>{#if canKnow}<button type="button" class="known" onclick={know}>знаю</button>{/if}</div>{/if}
    </div>
  {/if}
  {#if clip.source}<p class="src">{clip.source.name}{clip.source.license ? ` · ${clip.source.license}` : ''}{clip.source.credit ? ` · ${clip.source.credit}` : ''}</p>{/if}
</section>

<style>
  .listen { padding: 12px; margin: 0 4px 12px; display: grid; gap: 10px; }
  video { width: 100%; border-radius: 12px; background: #000; display: block; max-height: 42vh; }
  .bar { display: flex; align-items: center; gap: 10px; }
  .play { flex: none; width: 52px; height: 52px; border-radius: 50%; border: 0; background: var(--brand); color: var(--on-brand); display: grid; place-items: center; cursor: pointer; box-shadow: 0 2px 0 var(--brand-edge); }
  .play:active { transform: translateY(2px); box-shadow: none; }
  .play svg { width: 22px; height: 22px; fill: currentColor; }
  .seek { flex: 1; min-width: 0; accent-color: var(--amber); }
  .time { flex: none; font: 400 12px/1 var(--font-mono); color: var(--ink-2); }
  .tools { display: flex; gap: 6px; flex-wrap: wrap; }
  .tool { height: 34px; padding: 0 12px; border-radius: 17px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); font: 500 13px/1 var(--font-body); cursor: pointer; }
  .tool.on { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
  .text { position: relative; max-height: 260px; overflow-y: auto; padding: 4px 2px; border-top: 1px solid var(--line); }
  .seg { margin: 6px 0; font-size: 16px; line-height: 1.6; color: var(--ink-2); }
  .seg.now { color: var(--ink); }
  .at { border: 0; background: var(--soft); color: var(--ink-3); border-radius: 6px; padding: 1px 6px; font: 400 11px/1.6 var(--font-mono); cursor: pointer; margin-right: 6px; vertical-align: 1px; }
  .who { font-weight: 600; margin-right: 4px; }
  .w { cursor: pointer; border-radius: 4px; }
  .w.said { color: var(--ink); }
  .w.spoken { background: var(--amber-soft); }
  .w.glossed { background: var(--amber-soft); box-shadow: 0 0 0 2px var(--amber-soft); }
  .tip { position: absolute; z-index: 5; transform: translate(-50%, calc(-100% - 8px)); max-width: 280px; padding: 8px 12px; border-radius: 12px; background: var(--brand); color: var(--on-brand); display: grid; gap: 2px; font-size: 14px; pointer-events: none; }
  .tip b { font-weight: 600; }
  .tip.can-know { grid-template-columns: minmax(0, 1fr) auto; column-gap: 14px; }
  .known { grid-column: 2; grid-row: 1 / span 2; align-self: center; pointer-events: auto; height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--on-brand); background: var(--brand); color: var(--on-brand); font: 500 13px/1 var(--font-body); cursor: pointer; }
  .src { margin: 0; font-size: 11px; color: var(--ink-3); }
  .err { margin: 0; color: var(--again); font-size: 14px; }
</style>
