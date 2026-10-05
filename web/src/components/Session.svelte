<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ExerciseFrame from './ExerciseFrame.svelte';
  import { app, backend, refreshPending, scheduleSync, sync, touch } from '../lib/state.svelte';
  import { check } from '../lib/check';
  import { formatInterval, preview } from '../lib/fsrs';
  import { applyAnswer, applyIntro } from '../lib/progress';
  import { mediaUrl, render, topicOf, type Rendered } from '../lib/render';
  import { buildSession, LEARN_AHEAD, manifestOf, replacementItem } from '../lib/scheduler';
  import type { CheckResult, Grade, QueueItem, Skill } from '../lib/types';

  type Phase = 'answer' | 'graded' | 'flipped' | 'wait' | 'done';
  const data = app.data!;
  const GRADES: { g: Grade; label: string; cls: string }[] = [
    { g: 1, label: 'Снова', cls: 'again' }, { g: 2, label: 'Трудно', cls: 'hard' },
    { g: 3, label: 'Хорошо', cls: 'good' }, { g: 4, label: 'Легко', cls: 'easy' },
  ];
  const SKILL_LABEL: Record<Skill, string> = { recognize: 'узнавание', recall: 'вспоминание', listen: 'на слух', spell: 'написание', context: 'в предложении', apply: 'правило' };

  let queue = $state<QueueItem[]>([]);
  let index = $state(0);
  let phase = $state<Phase>('answer');
  let rendered = $state<Rendered | { error: string } | null>(null);
  let result = $state<CheckResult | null>(null);
  let suggested = $state<Grade>(3);
  let practice = $state(false);
  let answerMs = 0;
  let hints = 0;
  let frame = $state<ExerciseFrame>();
  let nextDue = $state<Date | null>(null);
  let saveError = $state('');
  let answered = $state(0);
  let correct = $state(0);
  const revealed = new Map<string, Map<string, number>>();
  const requeued = new Map<string, number>();
  const audio = new Audio();

  const item = $derived(queue[index]);
  const intervals = $derived.by(() => {
    if (!item || item.topicCards || !item.skills[0] || (phase !== 'graded' && phase !== 'flipped')) return null;
    const now = new Date();
    const due = preview(data.deck, item.skills[0], item.card.progress?.skills?.[item.skills[0]], now);
    return Object.fromEntries(GRADES.map(({ g }) => [g, formatInterval(now, due[g])])) as Record<Grade, string>;
  });

  function show() {
    const current = queue[index];
    result = null; practice = false; hints = 0; phase = 'answer';
    rendered = current ? render(data, current.card, current.exercise, current.mode, app.effectiveTheme, String(index)) : null;
  }

  function start(aheadMs = 0) {
    const plan = buildSession(data, new Date(), true, aheadMs);
    nextDue = plan.nextDue;
    if (!plan.queue.length) {
      phase = nextDue && nextDue.getTime() - Date.now() < LEARN_AHEAD ? 'wait' : 'done';
      if (answered) sync();
      return;
    }
    queue = plan.queue; index = 0;
    prefetch(plan.queue);
    revealed.clear();
    show();
  }

  function advance() {
    if (index + 1 < queue.length) { index += 1; show(); return; }
    start();
  }

  function remember(cardId: string, forms: string[]) {
    const map = revealed.get(cardId) ?? new Map<string, number>();
    forms.forEach((f) => map.set(f, index));
    revealed.set(cardId, map);
  }

  function isPrimed(current: QueueItem): boolean {
    const asks = manifestOf(data, current.card, current.exercise)?.asks ?? [];
    const seen = revealed.get(current.card.id);
    return asks.length > 0 && !!seen && asks.every((f) => seen.has(f) && index - seen.get(f)! <= 14);
  }

  function onAnswer(value: any, ms: number, hintCount: number) {
    const current = item;
    const r = rendered && 'template' in rendered ? rendered : null;
    if (!current || !r) return;
    answerMs = ms; hints = hintCount;
    const res = check(current.exercise, r.template.manifest, value, r.md);
    let grade = res.suggested;
    if (res.correct && hints > 0) grade = 2;
    const avg = current.card.progress?.exercises?.[current.exercise.id]?.avg_ms ?? 0;
    if (res.correct && grade === 3 && ms > Math.max(25000, avg * 2.5)) grade = 2;
    result = res;
    suggested = grade;
    practice = res.correct && isPrimed(current);
    phase = 'graded';
    frame?.send({ type: 'graded', correct: res.correct, expected: res.expected, marks: res.marks });
  }

  function giveUp() {
    if (phase !== 'answer' || !item) return;
    const expected = String(item.exercise.params?.answer ?? '');
    result = { correct: false, typo: false, expected, suggested: 1 };
    suggested = 1; phase = 'graded';
    frame?.send({ type: 'graded', correct: false, expected });
  }

  function skip() {
    if (!item || phase !== 'answer') return;
    queue.push({ ...item, key: `${item.key}:skip` });
    advance();
  }

  function persist(updates: { cardPath: string; progress: any }[], lines: string[]) {
    backend().saveAnswer(app.device, updates, lines)
      .then(() => { saveError = ''; refreshPending(); scheduleSync(); })
      .catch((e) => { saveError = `Прогресс не сохранён: ${e.message}`; });
  }

  async function grade(g: Grade) {
    const current = item;
    if (!current || (phase !== 'graded' && phase !== 'flipped')) return;
    const now = new Date();
    const members = current.topicCards ?? [current.card];
    const updates = [];
    const lines: string[] = [];
    for (const card of members) {
      const skills = current.topicCards ? [current.exercise.cards![card.id]] : current.skills;
      const effect = applyAnswer({ deck: data.deck, card, exercise: current.exercise, skills, grade: g, practice, ms: answerMs, now, device: app.device });
      card.progress = effect.progress;
      updates.push({ cardPath: card.path, progress: $state.snapshot(effect.progress) });
      lines.push(...effect.lines);
    }
    persist(updates, lines);
    answered += 1;
    if (g > 1) correct += 1;
    remember(current.card.id, manifestOf(data, current.card, current.exercise)?.reveals ?? []);
    const key = `${current.card.id}:${current.skills[0]}`;
    if (g === 1 && !practice && (requeued.get(key) ?? 0) < 2) {
      const again = replacementItem(data, current);
      if (again) { queue.splice(Math.min(queue.length, index + 4), 0, again); requeued.set(key, (requeued.get(key) ?? 0) + 1); }
    }
    touch();
    advance();
  }

  function introDone() {
    const current = item;
    if (!current) return;
    const effect = applyIntro(current.card, new Date(), app.device);
    current.card.progress = effect.progress;
    persist([{ cardPath: current.card.path, progress: $state.snapshot(effect.progress) }], effect.lines);
    remember(current.card.id, ['en', 'ru', 'audio']);
    touch();
    advance();
  }

  async function play(src: string, rate = 1, auto = false) {
    if (!src) return;
    try { audio.src = await backend().media(src); } catch { if (!auto) saveError = 'Аудио ещё не загружено — нужна сеть.'; return; }
    audio.playbackRate = rate;
    audio.play().catch(() => { if (!auto) saveError = 'Браузер не дал воспроизвести звук — нажмите кнопку ещё раз.'; });
  }

  function prefetch(items: QueueItem[]) {
    if (backend().kind !== 'github') return;
    const urls = new Set<string>();
    for (const { card } of items) {
      if (card.content.audio) urls.add(mediaUrl(card, card.content.audio));
      card.content.examples?.forEach((e) => e.audio && urls.add(mediaUrl(card, e.audio)));
    }
    (async () => { for (const u of urls) await backend().media(u).catch(() => ''); })();
  }

  function handleKey(key: string) {
    if (phase === 'graded' || phase === 'flipped') {
      if (/^[1-4]$/.test(key)) grade(Number(key) as Grade);
      else if (key === 'Enter' || key === ' ') grade(phase === 'flipped' ? 3 : suggested);
    } else if (phase === 'answer' && key === 'Escape') skip();
  }

  function onevent(type: string, d: any) {
    if (type === 'answer') onAnswer(d.value, d.ms, d.hints);
    else if (type === 'flip') { answerMs = d.ms; hints = d.hints; suggested = 3; phase = 'flipped'; }
    else if (type === 'next') introDone();
    else if (type === 'play') play(d.src, d.rate, d.auto);
    else if (type === 'skip') skip();
    else if (type === 'grade') grade(d.grade);
    else if (type === 'key') handleKey(d.key);
  }

  onMount(() => {
    start();
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.('input, textarea')) return;
      if (e.key === ' ' && (phase === 'graded' || phase === 'flipped')) e.preventDefault();
      handleKey(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); audio.pause(); };
  });

  $effect(() => { if (phase === 'graded' || phase === 'flipped') tick().then(() => document.querySelector<HTMLButtonElement>('.grades .suggested')?.focus({ preventScroll: true })); });

  const modeLabel = $derived(item ? ({ intro: 'Новое', learn: 'Изучение', review: 'Повторение', practice: 'Практика' } as const)[item.mode] : '');
  const progressPct = $derived(queue.length ? `${(index / queue.length) * 100}%` : '0%');
  const timeTo = (d: Date) => formatInterval(new Date(), d);
</script>

<div class="narrow session">
  {#if phase === 'done' || phase === 'wait'}
    <section class="finish paper-card">
      <div class="eyebrow">{phase === 'wait' ? 'Перерыв' : 'Занятие окончено'}</div>
      <h1 class="display">{phase === 'wait' ? 'Слова ещё не остыли' : answered ? 'Готово!' : 'Сейчас нечего повторять'}</h1>
      {#if answered}<p class="mono score">{answered} заданий · {Math.round((correct / answered) * 100)}% верно</p>{/if}
      {#if nextDue}<p class="muted">Следующее повторение через {timeTo(nextDue)}.</p>{/if}
      <div class="actions">
        {#if phase === 'wait'}<button class="btn" type="button" onclick={() => start(LEARN_AHEAD)}>Продолжить сейчас</button>{/if}
        <a class="btn ghost" href="#/">На главную</a>
      </div>
    </section>
  {:else if item}
    <div class="head">
      <a class="close" href="#/" aria-label="Закончить занятие">×</a>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={queue.length} aria-valuenow={index}><i style:width={progressPct}></i></div>
      <span class="mono count">{index + 1}/{queue.length}</span>
    </div>
    <div class="meta">
      <span class="chip {item.mode === 'review' ? 'review' : 'learning'}">{modeLabel}</span>
      <span class="muted">{topicOf(data, item.card).title}</span>
      {#if item.skills.length}<span class="muted">· {item.skills.map((s) => SKILL_LABEL[s]).join(', ')}</span>{/if}
    </div>

    <article class="paper-card exercise">
      {#if rendered && 'error' in rendered}
        <p class="err">{rendered.error}</p>
        <button class="btn small ghost" type="button" onclick={advance}>Пропустить</button>
      {:else if rendered}
        {#key item.key}<ExerciseFrame bind:this={frame} srcdoc={rendered.srcdoc} {onevent} />{/key}
      {/if}
    </article>

    {#if phase === 'graded' || phase === 'flipped'}
      <section class="feedback" class:ok={phase === 'graded' && result?.correct} class:bad={phase === 'graded' && !result?.correct}>
        {#if phase === 'graded' && result}
          <div class="verdict">
            <b>{result.correct ? (result.typo ? 'Верно, но с опечаткой' : 'Верно') : 'Неверно'}</b>
            {#if (!result.correct || result.typo) && result.expected}<span>Правильно: <span class="mono">{result.expected}</span></span>{/if}
            {#if practice}<span class="muted note">Ответ уже встречался в этом цикле — засчитано как практика.</span>{/if}
          </div>
        {/if}
        <div class="grades">
          {#each GRADES as { g, label, cls } (g)}
            <button type="button" class="{cls}" class:suggested={g === (phase === 'flipped' ? 3 : suggested)} onclick={() => grade(g)}>
              <span>{label}</span><small class="mono">{g}{intervals ? ` · ${intervals[g]}` : ''}</small>
            </button>
          {/each}
        </div>
      </section>
    {:else if item.mode !== 'intro'}
      <div class="tools">
        <button class="link" type="button" onclick={giveUp}>Не знаю</button>
        <button class="link" type="button" onclick={skip}>Пропустить <span class="mono">Esc</span></button>
      </div>
    {/if}
    {#if saveError}<p class="toast">{saveError}</p>{/if}
  {/if}
</div>

<style>
  .session { padding-top: 18px; }
  .head { display: flex; align-items: center; gap: 14px; }
  .close { font-size: 26px; line-height: 1; text-decoration: none; color: var(--ink-3); width: 28px; }
  .progress { flex: 1; height: 6px; border-radius: 3px; background: var(--soft); overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
  .count { font-size: 12px; color: var(--ink-3); }
  .meta { display: flex; gap: 8px; align-items: center; margin: 16px 0 10px; font-size: 13px; flex-wrap: wrap; }
  .exercise { padding: 22px 22px 18px; min-height: 260px; }
  @media (max-width: 520px) { .exercise { padding: 16px 14px 14px; } }
  .err { color: var(--again); }
  .tools { display: flex; justify-content: space-between; margin-top: 12px; }
  .link { background: none; border: 0; color: var(--ink-3); font-size: 14px; cursor: pointer; padding: 6px 2px; }
  .link:hover { color: var(--ink); }
  .link .mono { font-size: 11px; border: 1px solid var(--rule-strong); border-radius: 4px; padding: 1px 4px; margin-left: 4px; }
  .feedback { margin-top: 14px; display: grid; gap: 12px; padding: 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--rule); animation: rise .18s ease-out; }
  .feedback.ok { border-color: color-mix(in srgb, var(--good) 45%, var(--rule)); }
  .feedback.bad { border-color: color-mix(in srgb, var(--again) 45%, var(--rule)); }
  @keyframes rise { from { transform: translateY(6px); opacity: 0; } }
  .verdict { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; }
  .ok .verdict b { color: var(--good); }
  .bad .verdict b { color: var(--again); }
  .note { flex-basis: 100%; font-size: 13px; }
  .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .grades button { display: grid; gap: 3px; padding: 11px 6px 9px; border-radius: 9px; border: 1px solid var(--rule-strong); background: var(--paper); cursor: pointer; font-weight: 600; }
  .grades button small { font-size: 11px; color: var(--ink-3); font-weight: 400; }
  .grades .again { color: var(--again); } .grades .hard { color: var(--hard); } .grades .good { color: var(--good); } .grades .easy { color: var(--easy); }
  .grades button.suggested { border-color: currentColor; box-shadow: 0 0 0 1px currentColor; background: var(--card); }
  .finish { padding: 30px 26px; text-align: left; margin-top: 30px; }
  .score { font-size: 15px; }
  .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  .toast { margin-top: 12px; font-size: 13px; color: var(--again); }
</style>
