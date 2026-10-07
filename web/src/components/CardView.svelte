<script lang="ts">
  import YAML from 'yaml';
  import ExerciseFrame from './ExerciseFrame.svelte';
  import ListeningPanel from './ListeningPanel.svelte';
  import { app, backend, refreshPending, scheduleSync, touch } from '../lib/state.svelte';
  import { check } from '../lib/check';
  import { formatInterval, retrievability } from '../lib/fsrs';
  import { renderMarkdown } from '../lib/md';
  import { mediaUrl, pickVoice, render, type Rendered } from '../lib/render';
  import { cardSkills, exerciseSkills, manifestOf } from '../lib/scheduler';
  import { STAGE_LABEL, stageOf } from '../lib/summary';
  import { isBuried, suspend, unsuspend } from '../lib/progress';
  import type { CheckResult, Exercise, ExerciseStatus } from '../lib/types';

  let { topicId, cardId }: { topicId: string; cardId: string } = $props();
  const data = $derived(app.data!);
  const card = $derived(data.topics.find((t) => t.id === topicId)?.cards.find((c) => c.id === cardId));
  const now = $derived.by(() => { void app.version; return new Date(); });

  let selectedId = $state('');
  let salt = $state(0);
  let frame = $state<ExerciseFrame>();
  let verdict = $state<CheckResult | null>(null);
  let editing = $state(false);
  let draft = $state('');
  let message = $state('');
  const audio = new Audio();

  const selected = $derived(card?.exercises.find((e) => e.id === selectedId) ?? card?.exercises[0]);
  const rendered = $derived<Rendered | { error: string } | null>(card && selected ? render(data, card, selected, selected.template === 'intro' ? 'intro' : 'review', app.effectiveTheme, `p${salt}`) : null);

  async function playUrl(url: string, rate = 1) {
    try { audio.src = await backend().media(url); audio.playbackRate = rate; await audio.play(); } catch { message = 'Не удалось воспроизвести аудио.'; }
  }

  async function patch(body: Parameters<ReturnType<typeof backend>['patchExercise']>[0]) {
    await backend().patchExercise(body);
    await refreshPending();
    scheduleSync();
  }

  function select(ex: Exercise) { selectedId = ex.id; verdict = null; editing = false; message = ''; }
  function replay() { salt += 1; verdict = null; }

  function onevent(type: string, d: any) {
    if (!card || !selected || !rendered || !('template' in rendered)) return;
    if (type === 'play') playUrl(d.src, d.rate ?? 1);
    if (type === 'stop-audio') audio.pause();
    if (type === 'answer') {
      verdict = check(selected, rendered.template.manifest, d.value, rendered.md);
      frame?.send({ type: 'graded', correct: verdict.correct, expected: verdict.expected, marks: verdict.marks });
    }
  }

  async function setStatus(ex: Exercise, status: ExerciseStatus) {
    if (!card) return;
    try {
      await patch({ cardPath: card.path, exerciseId: ex.id, file: ex.file, patch: { status } });
      ex.status = status; touch(); message = '';
    } catch (e) { message = (e as Error).message; }
  }

  function startEdit() {
    if (!selected) return;
    draft = selected.file ? selected.params.markdown : YAML.stringify(selected.params, { lineWidth: 0 });
    editing = true; message = '';
  }

  async function saveEdit() {
    if (!card || !selected) return;
    try {
      const params = selected.file ? { markdown: draft } : YAML.parse(draft);
      await patch({ cardPath: card.path, exerciseId: selected.id, file: selected.file, patch: { params } });
      selected.params = params; editing = false; salt += 1; touch(); message = 'Сохранено';
    } catch (e) { message = `Не сохранено: ${(e as Error).message}`; }
  }

  const stat = (id: string) => card?.progress?.exercises?.[id];

  async function toggleSuspend() {
    if (!card) return;
    const progress = card.progress?.stage === 'suspended' ? unsuspend(card, new Date()) : suspend(card, new Date());
    card.progress = progress;
    await backend().saveAnswer(app.device, [{ cardPath: card.path, progress: $state.snapshot(progress) }], []);
    await refreshPending(); scheduleSync(); touch();
  }
</script>

<div class="wrap wide">
  {#if !card}
    <p class="muted" style="margin-top:40px">Карточка не найдена. <a href="#/">На главную</a></p>
  {:else}
    <a class="back" href="#/words" onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>← Слова</a>
    <div class="layout">
      <section class="content">
        <div class="eyebrow tags">{card.kind} <span class="chip {stageOf(card)}">{STAGE_LABEL[stageOf(card)]}</span>
          {#if card.progress?.leech}<span class="chip leech">пиявка</span>{/if}
          {#if isBuried(card, now)}<span class="chip">отложено до завтра</span>{/if}
          <button class="btn small ghost" type="button" onclick={toggleSuspend}>{card.progress?.stage === 'suspended' ? 'Вернуть в занятия' : 'Приостановить'}</button>
        </div>
        {#if card.progress?.leech}<p class="leech-note">Это слово часто забывается. Помогает своя заметка-ассоциация, ещё один пример или картинка — отредактируйте карточку.</p>{/if}
        {#if card.listening}<ListeningPanel {card} />{/if}
        <div class="title">
          {#if card.content.audio}<button class="play" type="button" aria-label="Прослушать" onclick={() => playUrl(mediaUrl(card, pickVoice(data, card, card.content.audio!, Math.floor(Math.random() * 1e9))))}><svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z" /></svg></button>{/if}
          <h1 class="display">{card.content.term ?? card.content.title}</h1>
        </div>
        {#if card.content.ipa}<div class="mono muted">/{card.content.ipa}/ {card.content.pos ? `· ${card.content.pos}` : ''}</div>{/if}
        {#if card.content.formula}<div class="mono formula">{card.content.formula}</div>{/if}
        {#if card.content.meaning}<p class="ru">{card.content.meaning}{#if card.content.alt?.length}<span class="muted"> · {card.content.alt.join(', ')}</span>{/if}</p>{/if}
        {#if card.content.note}<div class="md note">{@html renderMarkdown(card.content.note)}</div>{/if}
        {#if card.theory}<details class="theory"><summary>Теория</summary><div class="md">{@html renderMarkdown(card.theory)}</div></details>{/if}

        <h2 class="section">Примеры</h2>
        <ul class="examples">
          {#each card.content.examples ?? [] as ex (ex.id)}
            <li>
              <button class="play small" type="button" aria-label="Прослушать" onclick={() => playUrl(mediaUrl(card, pickVoice(data, card, ex.audio ?? '', Math.floor(Math.random() * 1e9))))}><svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z" /></svg></button>
              <div><div>{ex.term}</div><div class="muted small">{ex.meaning}</div></div>
            </li>
          {/each}
        </ul>

        <h2 class="section">Навыки</h2>
        <table class="skills">
          <thead><tr><th>Навык</th><th>Память</th><th>Стабильность</th><th>Следующий</th></tr></thead>
          <tbody>
            {#each cardSkills(data, card) as s (s)}
              {@const st = card.progress?.skills?.[s]}
              <tr>
                <td>{s}</td>
                <td class="mono">{st ? `${Math.round(retrievability(data.deck, s, st, now) * 100)}%` : '—'}</td>
                <td class="mono">{st ? `${Math.round(st.s * 10) / 10} дн` : '—'}</td>
                <td class="mono">{st ? (new Date(st.due) <= now ? 'сейчас' : `через ${formatInterval(now, new Date(st.due))}`) : 'новый'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>

      <section class="editor">
        <div class="list">
          <div class="eyebrow">{card.exercises.length} заданий</div>
          {#each card.exercises as ex (ex.id)}
            {@const s = stat(ex.id)}
            <button type="button" class="row" class:on={ex.id === selected?.id} onclick={() => select(ex)}>
              <span class="chip {ex.status}">{ex.status}</span>
              <b>{ex.id}</b>
              <small class="mono">{ex.template}{exerciseSkills(data, card, ex).length ? ` · ${exerciseSkills(data, card, ex).join(', ')}` : ''}</small>
              {#if s}<small class="mono stat">{Math.round((s.correct / Math.max(1, s.shown)) * 100)}% · {s.shown}</small>{/if}
            </button>
          {/each}
        </div>

        {#if selected}
          <div class="preview">
            <div class="bar">
              <span class="mono muted">{manifestOf(data, card, selected)?.name ?? selected.template}</span>
              <div class="actions">
                {#each ['ready', 'draft', 'off'] as const as st (st)}
                  <button type="button" class="btn small ghost" class:active={selected.status === st} onclick={() => setStatus(selected, st)}>{st}</button>
                {/each}
                <button type="button" class="btn small ghost" onclick={replay}>Заново</button>
                <button type="button" class="btn small ghost" onclick={startEdit}>Параметры</button>
              </div>
            </div>
            <article class="paper-card frame">
              {#if rendered && 'error' in rendered}<p class="err">{rendered.error}</p>
              {:else if rendered}{#key rendered.srcdoc}<ExerciseFrame bind:this={frame} srcdoc={rendered.srcdoc} {onevent} />{/key}{/if}
            </article>
            {#if verdict}<p class="verdict" class:ok={verdict.correct}>{verdict.correct ? (verdict.typo ? 'Верно, с опечаткой' : 'Верно') : `Неверно · правильно: ${verdict.expected}`} → оценка {verdict.suggested}</p>{/if}
            {#if editing}
              <textarea class="mono" bind:value={draft} rows="12" spellcheck="false"></textarea>
              <div class="actions"><button class="btn small" type="button" onclick={saveEdit}>Сохранить</button><button class="btn small ghost" type="button" onclick={() => (editing = false)}>Отмена</button></div>
            {/if}
            {#if message}<p class="muted small">{message}</p>{/if}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .back { display: inline-block; margin: 22px 0 12px; font-size: 14px; text-decoration: none; color: var(--ink-3); }
  .layout { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 32px; align-items: start; }
  @media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
  .title { display: flex; gap: 14px; align-items: center; }
  .play { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--card); border: 1px solid var(--line); display: grid; place-items: center; cursor: pointer; flex: none; padding: 0; }
  .play svg { width: 40%; fill: currentColor; margin-left: 8%; }
  .play.small { width: 34px; height: 34px; }
  .tags { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .chip.leech { color: var(--again); }
  .leech-note { font-size: 14px; color: var(--ink-2); background: var(--soft); padding: 10px 12px; border-radius: 12px; }
  .ru { font-size: 19px; font-weight: 500; margin: 10px 0; }
  .formula { color: var(--ink-2); margin-top: 6px; font-family: var(--font-body); }
  .note { color: var(--ink-2); font-size: 15px; }
  .theory { margin-top: 12px; }
  .theory summary { cursor: pointer; font-weight: 600; }
  .examples { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .examples li { display: grid; grid-template-columns: 32px 1fr; gap: 12px; align-items: center; }
  .small { font-size: 14px; }
  .skills { width: 100%; border-collapse: collapse; font-size: 14px; }
  .skills th, .skills td { text-align: left; padding: 6px 6px 6px 0; border-bottom: 1px solid var(--rule); }
  .skills th { font: 500 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .05em; color: var(--ink-3); }
  .editor { display: grid; gap: 14px; position: sticky; top: 72px; }
  @media (max-width: 900px) { .editor { position: static; } }
  .list { display: grid; gap: 0; max-height: 320px; overflow-y: auto; background: var(--card); border-radius: 16px; border: 1px solid var(--line); padding: 6px; }
  .list .eyebrow { padding: 6px 8px 8px; }
  .row { display: grid; grid-template-columns: 52px 46px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px; border: 0; border-radius: 10px; background: none; text-align: left; cursor: pointer; }
  .row:hover { background: var(--soft); }
  .row.on { background: var(--soft); }
  .row small { color: var(--ink-3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .chip { justify-content: center; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn.active { border-color: var(--ink); background: var(--soft); }
  .frame { padding: 22px; border-radius: 20px; border: 1px solid var(--line); }
  .verdict { font-size: 14px; color: var(--again); margin: 8px 0 0; }
  .verdict.ok { color: var(--good); }
  textarea { width: 100%; margin-top: 10px; font-size: 13px; padding: 10px; border-radius: 8px; border: 1px solid var(--rule-strong); background: var(--card); color: var(--ink); resize: vertical; }
  .err { color: var(--again); }
</style>
