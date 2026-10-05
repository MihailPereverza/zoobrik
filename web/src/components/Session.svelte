<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { renderMarkdown } from '../lib/md';
  import { log, mediaName } from '../lib/log';
  import ExerciseFrame from './ExerciseFrame.svelte';
  import Ring from './Ring.svelte';
  import InlineView from './InlineView.svelte';
  import { dayStats, plural } from '../lib/activity';
  import { app, backend, refreshPending, scheduleSync, sync, touch } from '../lib/state.svelte';
  import { check } from '../lib/check';
  import { formatInterval, preview } from '../lib/fsrs';
  import { applyAnswer, applyIntro, bury, suspend } from '../lib/progress';
  import { mediaUrl, render, topicOf, type Rendered } from '../lib/render';
  import { balanceDue, buildSession, isPrimed, LEARN_AHEAD, manifestOf, practiceSession, replacementItem } from '../lib/scheduler';
  import type { CheckResult, Grade, QueueItem, Skill } from '../lib/types';

  type Phase = 'answer' | 'reveal' | 'graded' | 'flipped' | 'wait' | 'done';
  const FLIP_MS = 220;
  let { practiceTopic = '' }: { practiceTopic?: string } = $props();
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
  interface UndoStep { index: number; snapshots: { card: QueueItem['card']; progress: unknown }[]; lines: string[]; inserted?: string }
  let history = $state<UndoStep[]>([]);
  let menuOpen = $state(false);
  let notice = $state('');
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
    if (current) {
      prefetch([current]);
      log('session', 'show', { n: index + 1, of: queue.length, card: current.card.id, exercise: current.exercise.id, template: current.exercise.template, mode: current.mode, skills: current.skills });
      if ('error' in (rendered ?? {})) log('session', 'render error', (rendered as { error: string }).error);
    }
  }

  function start(aheadMs = 0) {
    if (practiceTopic) {
      if (queue.length) { phase = 'done'; nextDue = null; if (answered) sync(); return; }
      queue = practiceSession(data, practiceTopic, new Date());
      index = 0;
      if (!queue.length) { phase = 'done'; return; }
      prefetch(queue); revealed.clear(); show();
      return;
    }
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

  function primed(current: QueueItem): boolean {
    return isPrimed(manifestOf(data, current.card, current.exercise)?.asks ?? [], revealed.get(current.card.id), index, current.mode);
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
    practice = res.correct && primed(current);
    log('session', 'answer', { correct: res.correct, typo: res.typo, suggested: grade, ms, hints, practice: res.correct && primed(current) });
    navigator.vibrate?.(res.correct ? 12 : [20, 40, 20]);
    reveal(res, 'graded');
  }

  let flipping = $state(false);
  let target: Phase = 'graded';

  // Keep the right/wrong outline until the learner taps to flip the card to the explanation.
  function reveal(res: CheckResult, next: Phase) {
    phase = 'reveal';
    target = next;
    frame?.send({ type: 'graded', correct: res.correct, expected: res.expected, marks: res.marks });
    tick().then(() => document.querySelector<HTMLButtonElement>('.flip-btn')?.focus({ preventScroll: true }));
  }

  function flipNow() {
    if (phase !== 'reveal' || flipping) return;
    log('session', 'flip', { to: target });
    flipping = true;
    setTimeout(() => { flipping = false; phase = target; }, FLIP_MS);
  }

  function giveUp() {
    if (phase !== 'answer' || !item) return;
    const expected = String(item.exercise.params?.answer ?? '');
    result = { correct: false, typo: false, expected, suggested: 1 };
    suggested = 1;
    reveal(result, 'graded');
  }

  function skip() {
    if (!item || phase !== 'answer') return;
    queue.push({ ...item, key: `${item.key}:skip` });
    advance();
  }

  function persist(updates: { cardPath: string; progress: any }[], lines: string[]) {
    backend().saveAnswer(app.device, updates, lines)
      .then(() => { saveError = ''; refreshPending(); scheduleSync(); })
      .catch((e) => { log('save', 'failed', String(e.message)); saveError = `Прогресс не сохранён: ${e.message}`; });
  }

  async function grade(g: Grade) {
    const current = item;
    if (!current || (phase !== 'graded' && phase !== 'flipped')) return;
    const now = new Date();
    log('session', 'grade', { card: current.card.id, exercise: current.exercise.id, grade: g, practice });
    const members = current.topicCards ?? [current.card];
    const updates = [];
    const lines: string[] = [];
    const snapshots = members.map((card) => ({ card, progress: card.progress ? $state.snapshot(card.progress) : undefined }));
    const isPractice = practice || current.mode === 'practice';
    for (const card of members) {
      const skills = current.topicCards ? [current.exercise.cards![card.id]] : current.skills;
      const effect = applyAnswer({ deck: data.deck, card, exercise: current.exercise, skills, grade: g, practice: isPractice, ms: answerMs, now, device: app.device });
      if (!isPractice) for (const s of skills) if (effect.progress.skills[s]) effect.progress.skills[s] = balanceDue(data, card, effect.progress.skills[s]!);
      if (effect.becameLeech) { notice = `«${card.content.en ?? card.content.title}» стало пиявкой: слишком много ошибок. Загляните в карточку — поможет своя заметка или пример.`; log('session', 'leech', card.id); }
      card.progress = effect.progress;
      updates.push({ cardPath: card.path, progress: $state.snapshot(effect.progress) });
      lines.push(...effect.lines);
    }
    persist(updates, lines);
    answered += 1;
    if (g > 1) correct += 1;
    remember(current.card.id, manifestOf(data, current.card, current.exercise)?.reveals ?? []);
    const key = `${current.card.id}:${current.skills[0]}`;
    let inserted: string | undefined;
    if (g === 1 && !isPractice && (requeued.get(key) ?? 0) < 2) {
      const again = replacementItem(data, current);
      if (again) { queue.splice(Math.min(queue.length, index + 4), 0, again); requeued.set(key, (requeued.get(key) ?? 0) + 1); inserted = again.key; }
    }
    history = [...history.slice(-19), { index, snapshots, lines, inserted }];
    touch();
    advance();
  }

  function introDone() {
    const current = item;
    if (!current) return;
    log('session', 'intro done', current.card.id);
    const effect = applyIntro(current.card, new Date(), app.device);
    current.card.progress = effect.progress;
    persist([{ cardPath: current.card.path, progress: $state.snapshot(effect.progress) }], effect.lines);
    touch();
    advance();
  }

  // Called straight from a tap: start audio synchronously when the file is already on the device.
  function playNow(src: string, rate = 1) {
    const local = backend().mediaNow(src);
    if (!local) { log('audio', 'not cached yet, loading', mediaName(src)); play(src, rate); return; }
    audio.pause();
    audio.src = local;
    audio.playbackRate = rate;
    audio.play().then(() => log('audio', 'playing in app', mediaName(src)), (e) => { log('audio', 'app play failed', { src: mediaName(src), error: e?.name, message: e?.message }); saveError = 'Браузер не дал воспроизвести звук — нажмите кнопку ещё раз.'; });
  }

  async function play(src: string, rate = 1, auto = false) {
    if (!src) return;
    log('audio', auto ? 'autoplay in app' : 'play in app', mediaName(src));
    try { audio.src = await backend().media(src); } catch (e) { log('audio', 'media unavailable', { src: mediaName(src), error: String((e as Error).message) }); if (!auto) saveError = 'Аудио ещё не загружено — нужна сеть.'; return; }
    audio.playbackRate = rate;
    audio.play().then(() => log('audio', 'playing in app', mediaName(src)), (e) => { log('audio', 'app play failed', { src: mediaName(src), error: e?.name, message: e?.message }); if (!auto) saveError = 'Браузер не дал воспроизвести звук — нажмите кнопку ещё раз.'; });
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

  // Undo restores the cards' previous progress and returns to the answered exercise; the journal gets an undo line.
  function undo() {
    const step = history.at(-1);
    if (!step) return;
    history = history.slice(0, -1);
    const updates = step.snapshots.map(({ card, progress }) => {
      card.progress = progress as typeof card.progress;
      return { cardPath: card.path, progress: (progress ?? { stage: 'new', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] }) as any };
    });
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const undoLines = step.lines.map((l) => { const f = l.split('\t'); return [now, f[1], f[2], f[3], 'undo', 0, app.device, `ref=${f[0]}`].join('\t'); });
    persist(updates, undoLines);
    if (step.inserted) queue = queue.filter((q) => q.key !== step.inserted);
    answered = Math.max(0, answered - 1);
    log('session', 'undo', { card: step.snapshots[0]?.card.id, back_to: step.index + 1 });
    menuOpen = false; notice = '';
    index = step.index;
    touch();
    show();
  }

  function setAside(kind: 'bury' | 'suspend') {
    const current = item;
    if (!current) return;
    const card = current.card;
    const progress = kind === 'bury' ? bury(card, new Date()) : suspend(card, new Date());
    card.progress = progress;
    persist([{ cardPath: card.path, progress: $state.snapshot(progress) }], []);
    queue = [...queue.slice(0, index + 1), ...queue.slice(index + 1).filter((q) => q.card !== card)];
    log('session', kind, card.id);
    notice = kind === 'bury' ? `«${card.content.en ?? card.content.title}» отложено до завтра.` : `«${card.content.en ?? card.content.title}» приостановлено. Вернуть можно на странице карточки.`;
    menuOpen = false;
    touch();
    advance();
  }

  function handleKey(key: string) {
    if (key === 'u' || key === 'г') { if (history.length && phase !== 'reveal') undo(); return; }
    if (phase === 'reveal') { if (key === 'Enter' || key === ' ') flipNow(); return; }
    if (phase === 'graded' || phase === 'flipped') {
      if (/^[1-4]$/.test(key)) grade(Number(key) as Grade);
      else if (key === 'Enter' || key === ' ') grade(phase === 'flipped' ? 3 : suggested);
    } else if (phase === 'answer' && key === 'Escape') skip();
  }

  function onevent(type: string, d: any) {
    if (type === 'answer') onAnswer(d.value, d.ms, d.hints);
    else if (type === 'flip') { answerMs = d.ms; hints = d.hints; suggested = 3; phase = 'reveal'; target = 'flipped'; flipNow(); }
    else if (type === 'next') introDone();
    else if (type === 'play') play(d.src, d.rate, d.auto);
    else if (type === 'skip') skip();
    else if (type === 'grade') grade(d.grade);
    else if (type === 'key') handleKey(d.key);
    else if (type === 'tap' && phase === 'reveal') flipNow();
    else if (type === 'stop-audio') audio.pause();
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

  $effect(() => { if (phase === 'graded' || phase === 'flipped') window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $effect(() => { if (phase === 'graded' || phase === 'flipped') tick().then(() => document.querySelector<HTMLButtonElement>('.grades .suggested')?.focus({ preventScroll: true })); });

  const BACK = { id: 'back', template: 'back', status: 'ready', params: {} } as const;
  const showBack = $derived((phase === 'graded' || phase === 'flipped') && !!item && !item.topicCards && item.mode !== 'intro');
  const backRendered = $derived(showBack && item ? render(data, item.card, { ...BACK }, 'review', app.effectiveTheme, `b${index}`) : null);

  const extra = $derived.by(() => {
    if (!item || (phase !== 'graded' && phase !== 'flipped')) return null;
    const p = item.exercise.params ?? {};
    const md = rendered && 'md' in rendered ? rendered.md : undefined;
    const explanation = p.explanation ? renderMarkdown(p.explanation) : md?.back ?? '';
    const sentence = phase === 'flipped' && p.back ? String(p.back) : typeof p.answer === 'string' && p.answer !== item.card.content.en && /\s/.test(p.answer) && /[a-z]/i.test(p.answer) ? p.answer : '';
    return { explanation, translation: p.translation ?? '', sentence };
  });

  function flipIn(_node: Element, { duration = 300, delay = 0 } = {}) {
    return { duration, delay, css: (t: number) => { const e = 1 - Math.pow(1 - t, 3); return `transform: perspective(1400px) rotateX(${(1 - e) * -70}deg); transform-origin: 50% 0`; } };
  }

  let finishStats = $state<{ today: number; streak: number } | null>(null);
  $effect(() => {
    if (phase !== 'done' && phase !== 'wait') return;
    backend().activity().then((a) => { finishStats = dayStats(a); }).catch(() => {});
  });

  const modeLabel = $derived(item ? ({ intro: 'Новое', learn: 'Изучение', review: 'Повторение', practice: 'Практика' } as const)[item.mode] : '');
  const progressPct = $derived(queue.length ? `${(index / queue.length) * 100}%` : '0%');
  const timeTo = (d: Date) => formatInterval(new Date(), d);
</script>

<div class="narrow session">
  {#if phase === 'done' || phase === 'wait'}
    <section class="finish surface" in:fly={{ y: 12, duration: 400, opacity: 1 }}>
      {#if finishStats}<Ring value={finishStats.today} max={app.goal} size={120} label="заданий сегодня" />{/if}
      <h1 class="display">{phase === 'wait' ? 'Небольшой перерыв' : answered ? (finishStats && finishStats.today >= app.goal ? 'Цель на сегодня выполнена' : 'Отличная работа') : 'Сейчас нечего повторять'}</h1>
      {#if answered}
        <div class="result num">
          <div><b>{answered}</b><span>{plural(answered, 'задание', 'задания', 'заданий')}</span></div>
          <div><b>{Math.round((correct / answered) * 100)}%</b><span>верно</span></div>
          {#if finishStats?.streak}<div><b>{finishStats.streak}</b><span>{plural(finishStats.streak, 'день', 'дня', 'дней')} подряд</span></div>{/if}
        </div>
      {/if}
      {#if nextDue}<p class="muted">Следующее повторение через {timeTo(nextDue)}</p>{/if}
      <div class="actions">
        {#if phase === 'wait'}<button class="btn" type="button" onclick={() => start(LEARN_AHEAD)}>Продолжить сейчас</button>{/if}
        <a class="btn ghost" href="#/">На главную</a>
      </div>
    </section>
  {:else if item}
    <div class="head">
      <a class="close" href="#/" aria-label="Закончить занятие"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></a>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={queue.length} aria-valuenow={index}><i style:width={progressPct}></i></div>
      <span class="count num">{index + 1}/{queue.length}</span>
      <div class="menu-wrap">
        <button class="more" type="button" aria-label="Действия с карточкой" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></button>
        {#if menuOpen}
          <div class="menu" role="menu">
            <button type="button" role="menuitem" disabled={!history.length} onclick={undo}>Отменить последний ответ <span class="kbd">U</span></button>
            <button type="button" role="menuitem" onclick={() => setAside('bury')}>Отложить до завтра</button>
            <button type="button" role="menuitem" onclick={() => setAside('suspend')}>Приостановить карточку</button>
            <a role="menuitem" href="#/card/{item.card.topic}/{item.card.id}">Открыть карточку</a>
          </div>
        {/if}
      </div>
    </div>
    {#if notice}<p class="notice">{notice}</p>{/if}

    {#key item.key}
      <div class="step" in:fly={{ y: 14, duration: 320, opacity: 1 }}>
        <p class="meta">{[modeLabel, topicOf(data, item.card).title, item.skills.map((s) => SKILL_LABEL[s]).join(', ')].filter(Boolean).join(' · ')}</p>
        {#if phase === 'answer' || phase === 'reveal'}<article class="exercise surface" class:flipping>
          {#if rendered && 'error' in rendered}
            <p class="err">{rendered.error}</p>
            <button class="btn small ghost" type="button" onclick={advance}>Пропустить</button>
          {:else if rendered}
            <ExerciseFrame bind:this={frame} srcdoc={rendered.srcdoc} {onevent} name="exercise" />
          {/if}
        </article>{/if}
      </div>
    {/key}

    {#if phase === 'graded' || phase === 'flipped'}
      {#if phase === 'graded' && result}
        <div class="verdict" class:ok={result.correct} class:bad={!result.correct} in:flipIn={{ duration: 300 }}>
          <span class="icon" aria-hidden="true">{#if result.correct}<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{:else}<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>{/if}</span>
          <div>
            <b>{result.correct ? (result.typo ? 'Верно, но с опечаткой' : 'Верно') : 'Пока неверно'}</b>
            {#if (result.typo || !result.correct) && result.expected}<span>Правильно: <b class="exp">{result.expected}</b></span>{/if}
            {#if practice}<span>Ответ уже встречался в этом цикле — засчитано как практика</span>{/if}
          </div>
        </div>
      {/if}
      {#if extra && (extra.explanation || extra.translation || (extra.sentence && (phase === 'flipped' || result?.correct)))}
        <div class="explain surface" in:flipIn={{ duration: 320, delay: 30 }}>
          {#if extra.sentence && (phase === 'flipped' || result?.correct)}<p class="sentence">{extra.sentence}</p>{/if}
          {#if extra.translation}<p class="muted">{extra.translation}</p>{/if}
          {#if extra.explanation}<div class="md">{@html extra.explanation}</div>{/if}
        </div>
      {/if}
      {#if backRendered && 'srcdoc' in backRendered}
        <section class="back surface" in:flipIn={{ duration: 340, delay: 60 }}>{#key item.key}<InlineView html={backRendered.html} css={backRendered.css} onplay={playNow} />{/key}</section>
      {/if}
      <div class="grades" in:fly={{ y: 24, duration: 300, opacity: 1 }}>
        {#each GRADES as { g, label, cls } (g)}
          <button type="button" class="{cls}" class:suggested={g === (phase === 'flipped' ? 3 : suggested)} onclick={() => grade(g)}>
            <span>{label}</span>{#if intervals}<small class="num">{intervals[g]}</small>{/if}
          </button>
        {/each}
      </div>
    {:else if phase === 'reveal'}
      <button class="btn block flip-btn" type="button" onclick={flipNow} >Перевернуть</button>
    {:else if item.mode !== 'intro' && phase === 'answer'}
      <div class="tools">
        {#if history.length}<button class="link" type="button" onclick={undo}>← Отменить ответ</button>{/if}
        <button class="link" type="button" onclick={giveUp}>Не знаю</button>
        <button class="link" type="button" onclick={skip}>Пропустить</button>
      </div>
    {/if}
    {#if saveError}<p class="toast">{saveError}</p>{/if}
  {/if}
</div>

<style>
  .session { padding-top: 14px; padding-bottom: 24px; }
  .head { display: flex; align-items: center; gap: 14px; height: 36px; }
  .close { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: var(--ink-3); transition: background-color .2s; }
  .close:hover { background: var(--soft); color: var(--ink); }
  .close svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.8; fill: none; stroke-linecap: round; }
  .progress { flex: 1; height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; }
  .progress i { display: block; height: 100%; border-radius: 3px; background: var(--good); transition: width .5s var(--ease); }
  .count { font-size: 13px; color: var(--ink-3); min-width: 40px; text-align: right; }
  .meta { margin: 14px 4px 10px; font-size: 13px; color: var(--ink-3); }
  .exercise { padding: 26px 24px 22px; min-height: 240px; transform-origin: 50% 100%; }
  .exercise.flipping { animation: flip-out .22s cubic-bezier(.4, 0, 1, 1) forwards; }
  @keyframes flip-out { to { transform: perspective(1400px) rotateX(88deg); } }
  @media (max-width: 520px) { .exercise { padding: 22px 18px 18px; } }
  .err { color: var(--again); }
  .flip-btn { margin-top: 14px; }
  .menu-wrap { position: relative; }
  .more { width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--paper); display: grid; place-items: center; cursor: pointer; color: var(--ink-3); }
  .more:hover { background: var(--soft); color: var(--ink); }
  .more svg { width: 18px; height: 18px; fill: currentColor; }
  .menu { position: absolute; right: 0; top: 38px; z-index: 20; min-width: 240px; display: grid; padding: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  .menu button, .menu a { display: flex; justify-content: space-between; gap: 12px; text-align: left; padding: 10px 12px; border: 0; border-radius: 9px; background: var(--card); font-size: 14px; color: var(--ink); text-decoration: none; cursor: pointer; }
  .menu button:hover:not(:disabled), .menu a:hover { background: var(--soft); }
  .menu button:disabled { color: var(--ink-3); cursor: default; }
  .kbd { font-size: 11px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
  .notice { margin: 12px 4px 0; padding: 10px 14px; border-radius: 12px; background: var(--soft); color: var(--ink-2); font-size: 14px; }
  .tools { gap: 12px; display: flex; justify-content: space-between; margin: 14px 4px 0; }
  .link { background: none; border: 0; color: var(--ink-3); font-size: 14px; cursor: pointer; padding: 8px 4px; border-radius: 8px; transition: color .2s; }
  .link:hover { color: var(--ink); }
  .verdict { margin-top: 4px; display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 16px; }
  .verdict.ok { background: var(--good-bg); color: var(--good); }
  .verdict.bad { background: var(--again-bg); color: var(--again); }
  .verdict div { display: grid; gap: 2px; }
  .verdict b { font-weight: 600; }
  .verdict span:not(.icon) { font-size: 14px; color: var(--ink-2); }
  .icon { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: currentColor; flex: none; }
  .icon svg { width: 16px; height: 16px; fill: none; stroke: var(--card); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .back { margin-top: 12px; padding: 22px 24px; }
  .exp { font-weight: 500; }
  .explain { margin-top: 12px; padding: 18px 24px; display: grid; gap: 6px; font-size: 15px; }
  .explain p { margin: 0; }
  .explain .sentence { font-size: 18px; font-weight: 500; }
  .explain .md { color: var(--ink-2); }
  @media (max-width: 520px) { .explain { padding: 16px 18px; } }
  @media (max-width: 520px) { .back { padding: 18px; } }
  .grades { position: sticky; bottom: 0; z-index: 5; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; padding: 12px 0 calc(12px + env(safe-area-inset-bottom, 0px)); background: var(--paper); }
  .grades button { display: grid; gap: 2px; padding: 12px 4px 10px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--card); cursor: pointer; font-size: 15px; font-weight: 500; transition: transform .15s var(--ease), border-color .2s; }
  .grades button:active { transform: scale(.96); }
  .grades button small { font-size: 12px; font-weight: 400; color: var(--ink-3); }
  .grades button.suggested { border-color: currentColor; }
  .grades .again { color: var(--again); } .grades .hard { color: var(--hard); } .grades .good { color: var(--good); } .grades .easy { color: var(--easy); }
  .finish { margin-top: 36px; padding: 36px 28px 30px; display: grid; justify-items: center; text-align: center; gap: 2px; }
  .finish p { margin: 2px 0; }
  .finish :global(.ring) { margin-bottom: 14px; }
  .result { display: flex; gap: 28px; margin: 12px 0 14px; }
  .result div { display: grid; gap: 2px; }
  .result b { font-size: 22px; font-weight: 600; }
  .result span { font-size: 12px; color: var(--ink-3); }
  .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; justify-content: center; }
  .toast { margin: 12px 4px 0; font-size: 13px; color: var(--again); }
</style>
