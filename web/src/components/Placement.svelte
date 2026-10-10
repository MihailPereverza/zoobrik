<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { saveKnown } from '../lib/known';
  import { answerScreen, BAND, bandCount, placementResult, startPlacement, type PlacementState } from '../lib/placement';
  import { dayKey } from '../lib/progress';
  import { plural } from '../lib/activity';
  import { log } from '../lib/log';

  const words = $derived(app.data?.placement ?? []);
  const previous = app.data?.known;
  const ru = $derived(new Map(words.map((w) => [w.en, w.ru])));
  const bands = $derived(bandCount(words));

  let test = $state.raw<PlacementState | null>(null);
  let tapped = $state<Set<string>>(new Set());
  let showRu = $state(false);
  let result = $state.raw<{ known: number } | null>(null);
  let error = $state('');
  let saving = $state(false);

  function start() {
    test = startPlacement(words);
    tapped = new Set();
    log('placement', 'start', { words: words.length });
  }

  function toggle(w: string) {
    const next = new Set(tapped);
    if (!next.delete(w)) next.add(w);
    tapped = next;
  }

  async function next() {
    if (!test) return;
    test = answerScreen(words, test, tapped);
    tapped = new Set();
    showRu = false;
    window.scrollTo(0, 0);
    if (test.done) await finish();
  }

  async function finish() {
    const known = placementResult(words, test!, dayKey(new Date()));
    log('placement', 'done', { known: known.words.length, unknown: known.unknown?.length ?? 0, screens: test!.screens });
    result = { known: known.words.length };
    saving = true;
    try { await saveKnown(known); } catch (e) { error = `Не удалось сохранить: ${(e as Error).message}`; }
    saving = false;
  }

  const range = $derived(test ? `${test.band * BAND + 1}–${Math.min(words.length, (test.band + 1) * BAND)}` : '');
</script>

<div class="narrow placement">
  <div class="head">
    <a class="close" href="#/" aria-label="Выйти из теста"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></a>
    {#if test && !test.done}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={bands} aria-valuenow={test.band}><i style:width="{(test.band / bands) * 100}%"></i></div>
      <span class="count num">{range}</span>
    {/if}
  </div>

  {#if !words.length}
    <p class="muted lead">В этой колоде нет списка слов для теста (placement.yaml).</p>
  {:else if result}
    <section class="done appear">
      <h1 class="display">Готово</h1>
      <div class="panel score">
        <b class="num">{result.known}</b>
        <span>{plural(result.known, 'слово', 'слова', 'слов')} из {words.length} самых частых ты уже знаешь</span>
      </div>
      <p class="muted note">Примеры и задания будут опираться на эти слова и на те, что ты выучишь в карточках. Отдельное слово можно добавить позже: нажми на него в задании и выбери «знаю».</p>
      {#if error}<p class="error">{error}</p>{/if}
      <a class="btn block" href="#/" aria-disabled={saving}>{saving ? 'Сохраняю…' : 'К занятиям'}</a>
    </section>
  {:else if test}
    <p class="hint">Нажми на слова, которых <b>не знаешь</b></p>
    <div class="grid">
      {#each test.screen as w (w)}
        <button type="button" class="word" class:off={tapped.has(w)} aria-pressed={tapped.has(w)} onclick={() => toggle(w)}>
          <span class="en">{w}</span>
          {#if showRu}<span class="ru">{ru.get(w)}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="actions">
      <button class="btn ghost small" type="button" aria-pressed={showRu} class:on={showRu} onclick={() => (showRu = !showRu)}>{showRu ? 'Скрыть перевод' : 'Проверить себя'}</button>
      <button class="btn grow" type="button" onclick={next}>{tapped.size ? `Дальше · не знаю ${tapped.size}` : 'Знаю все'}</button>
    </div>
  {:else}
    <section class="intro appear">
      <h1 class="display">Какие слова ты уже знаешь?</h1>
      <p class="lead">Покажу частые английские слова по десять. Отметь те, которых не знаешь. Задания колоды будут строиться только из знакомых слов и слов из пройденных карточек.</p>
      <ul class="facts">
        <li>Обычно 2–5 минут: чем увереннее ответы, тем быстрее</li>
        <li>Сомневаешься — нажми «Проверить себя», появится перевод</li>
        <li>Без таймера, можно выйти в любой момент</li>
      </ul>
      {#if previous}<p class="muted note">Прошлый результат: {previous.words.length} {plural(previous.words.length, 'слово', 'слова', 'слов')}{previous.tested ? ` (${previous.tested})` : ''}. Новый тест заменит его.</p>{/if}
      <button class="btn block" type="button" onclick={start}>Начать</button>
    </section>
  {/if}
</div>

<style>
  .placement { padding-top: 8px; padding-bottom: 24px; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 44px; }
  .close { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; color: var(--ink-2); flex: none; }
  .close:hover { background: var(--soft); }
  .close svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2.2; fill: none; stroke-linecap: round; }
  .bar { flex: 1; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--brand); transition: width .4s var(--ease); }
  .count { font: 400 13px/1 var(--font-mono); color: var(--ink-3); min-width: 64px; text-align: right; }
  .intro, .done { display: grid; gap: 14px; margin-top: 18px; }
  .intro h1, .done h1 { margin: 0 4px; }
  .lead { margin: 0 4px; font-size: 16px; color: var(--ink-2); }
  .facts { margin: 0; padding: 0 4px; list-style: none; display: grid; gap: 8px; font-size: 15px; color: var(--ink-2); }
  .facts li { display: flex; gap: 10px; }
  .facts li::before { content: ''; flex: none; width: 6px; height: 6px; margin-top: 9px; border-radius: 50%; background: var(--ink-3); }
  .note { margin: 0 4px; font-size: 14px; }
  .hint { margin: 18px 4px 12px; font-size: 15px; color: var(--ink-2); }
  .hint b { color: var(--ink); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .word { min-height: 64px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; text-align: left; display: grid; align-content: center; gap: 2px; }
  .word:active { transform: translateY(1px); }
  .en { font: 600 18px/1.2 var(--font-display); letter-spacing: -.01em; overflow-wrap: anywhere; }
  .ru { font-size: 13px; line-height: 1.3; color: var(--ink-3); }
  .word.off { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
  .word.off .en { text-decoration: line-through; text-decoration-thickness: 1.5px; }
  .word.off .ru { color: var(--on-brand); }
  .actions { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
  .actions .small { height: 52px; flex: none; }
  .actions .on { background: var(--soft); }
  .grow { flex: 1; min-width: 0; padding: 0 12px; }
  .score { padding: 18px; display: grid; gap: 4px; }
  .score b { font: 600 40px/1 var(--font-display); letter-spacing: -.02em; }
  .score span { font-size: 15px; color: var(--ink-2); }
  .error { margin: 0 4px; font-size: 14px; color: var(--again); }
</style>
