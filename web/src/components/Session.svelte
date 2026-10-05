<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { renderMarkdown } from '../lib/md';
  import { log, mediaName } from '../lib/log';
  import ExerciseFrame from './ExerciseFrame.svelte';
  import Ring from './Ring.svelte';
  import InlineView from './InlineView.svelte';
  import GradeBar from './GradeBar.svelte';
  import Zubrik from './Zubrik.svelte';
  import { moodFor } from '../lib/mascot';
  import { typoLetters } from '../lib/typo';
  import { dayStats, plural } from '../lib/activity';
  import { app, backend, bumpActivity, goalMet, refreshPending, scheduleSync, sync, touch } from '../lib/state.svelte';
  import { check } from '../lib/check';
  import { formatInterval, preview } from '../lib/fsrs';
  import { applyAnswer, applyIntro, bury, suspend } from '../lib/progress';
  import { mediaUrl, render, type Rendered } from '../lib/render';
  import { filterCards, queryToFilter } from '../lib/words';
  import { balanceDue, buildSession, isPrimed, LEARN_AHEAD, manifestOf, practiceSession, replacementItem } from '../lib/scheduler';
  import type { CheckResult, Grade, QueueItem, Skill } from '../lib/types';

  type Phase = 'answer' | 'reveal' | 'graded' | 'flipped' | 'wait' | 'done';
  const FLIP_MS = 220;
  let { practice: practiceMode = false, practiceQuery = '' }: { practice?: boolean; practiceQuery?: string } = $props();
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
  let results = $state<Record<number, 'good' | 'hard' | 'bad'>>({});
  let streak = $state(0);
  let selected = $state<Grade | null>(null);
  let given = $state('');
  let introduced = $state(0);
  const startedAt = Date.now();
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
  let goalReached = $state(false);
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
    result = null; practice = false; hints = 0; phase = 'answer'; selected = null; given = '';
    rendered = current ? render(data, current.card, current.exercise, current.mode, app.effectiveTheme, String(index)) : null;
    if (current) {
      prefetch([current]);
      log('session', 'show', { n: index + 1, of: queue.length, card: current.card.id, exercise: current.exercise.id, template: current.exercise.template, mode: current.mode, skills: current.skills });
      if ('error' in (rendered ?? {})) log('session', 'render error', (rendered as { error: string }).error);
    }
  }

  function start(aheadMs = 0) {
    if (practiceMode) {
      if (queue.length) { phase = 'done'; nextDue = null; if (answered) sync(); return; }
      queue = practiceSession(data, filterCards(data, queryToFilter(practiceQuery), new Date()), new Date());
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
    selected = grade;
    given = typeof value?.text === 'string' ? value.text : '';
    streak = res.correct && !res.typo ? streak + 1 : 0;
    results[index] = !res.correct ? 'bad' : grade === 2 ? 'hard' : 'good';
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
    frame?.send({ type: 'graded', correct: res.correct, typo: res.typo, expected: res.expected, marks: res.marks });
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
    selected = 1;
    given = '';
    streak = 0;
    results[index] = 'bad';
    reveal(result, 'graded');
  }

  function skip() {
    if (!item || phase !== 'answer') return;
    queue.push({ ...item, key: `${item.key}:skip` });
    advance();
  }

  function persist(updates: { cardPath: string; progress: any }[], lines: string[]) {
    const before = goalMet();
    bumpActivity(lines);
    if (!before && goalMet()) { goalReached = true; log('session', 'daily goal reached', app.goal); }
    backend().saveAnswer(app.device, updates, lines)
      .then(() => { saveError = ''; refreshPending(); scheduleSync(); })
      .catch((e) => { log('save', 'failed', String(e.message)); saveError = `Прогресс не сохранён: ${e.message}`; });
  }

  async function grade(g: Grade) {
    const current = item;
    if (!current || (phase !== 'graded' && phase !== 'flipped')) return;
    const now = new Date();
    log('session', 'grade', { card: current.card.id, exercise: current.exercise.id, grade: g, practice });
    results[index] = g === 1 ? 'bad' : g === 2 ? 'hard' : 'good';
    const members = current.topicCards ?? [current.card];
    const updates = [];
    const lines: string[] = [];
    const snapshots = members.map((card) => ({ card, progress: card.progress ? $state.snapshot(card.progress) : undefined }));
    const isPractice = practice || current.mode === 'practice';
    for (const card of members) {
      const skills = current.topicCards ? [current.exercise.cards![card.id]] : current.skills;
      const effect = applyAnswer({ deck: data.deck, card, exercise: current.exercise, skills, grade: g, practice: isPractice, ms: answerMs, now, device: app.device });
      if (!isPractice) for (const s of skills) if (effect.progress.skills[s]) effect.progress.skills[s] = balanceDue(data, card, effect.progress.skills[s]!);
      if (effect.becameLeech) { notice = `«${card.content.term ?? card.content.title}» стало пиявкой: слишком много ошибок. Загляните в карточку — поможет своя заметка или пример.`; log('session', 'leech', card.id); }
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
    results[index] = 'good';
    introduced += 1;
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
    notice = kind === 'bury' ? `«${card.content.term ?? card.content.title}» отложено до завтра.` : `«${card.content.term ?? card.content.title}» приостановлено. Вернуть можно на странице карточки.`;
    menuOpen = false;
    touch();
    advance();
  }

  function handleKey(key: string) {
    if (key === 'u' || key === 'г') { if (history.length && phase !== 'reveal') undo(); return; }
    if (phase === 'reveal') { if (key === 'Enter' || key === ' ') flipNow(); return; }
    if (phase === 'graded' || phase === 'flipped') {
      const current = selected ?? (phase === 'flipped' ? 3 : suggested);
      const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
      // Arrows walk the four grades as a ring; Enter/Space confirms whatever is selected.
      if (step) selected = ((((current - 1 + step) % 4) + 4) % 4 + 1) as Grade;
      else if (/^[1-4]$/.test(key)) grade(Number(key) as Grade);
      else if (key === 'Enter' || key === ' ') grade(current);
    } else if (phase === 'answer' && key === 'Escape') skip();
  }

  function onevent(type: string, d: any) {
    if (type === 'answer') onAnswer(d.value, d.ms, d.hints);
    else if (type === 'flip') { answerMs = d.ms; hints = d.hints; suggested = 3; selected = 3; result = null; phase = 'reveal'; target = 'flipped'; flipNow(); }
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
      // Space and arrows would scroll the page, Enter would also click a focused grade tile after the grade is given.
      if ((e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow')) && (phase === 'graded' || phase === 'flipped')) e.preventDefault();
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
    const sentence = phase === 'flipped' && p.back ? String(p.back) : typeof p.answer === 'string' && p.answer !== item.card.content.term && /\s/.test(p.answer) && !/\p{Script=Cyrillic}/u.test(p.answer) ? p.answer : '';
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

  const exerciseName = $derived(item ? (rendered && 'template' in rendered ? (rendered.template.manifest.name ?? '') : '').replace(/\s*\(.*\)\s*$/, '') : '');
  const GRADE_NAME: Record<Grade, string> = { 1: 'Заново', 2: 'Трудно', 3: 'Хорошо', 4: 'Легко' };
  const tone = $derived(phase === 'flipped' || !result ? 'neutral' : !result.correct ? 'bad' : result.typo || suggested === 2 ? 'hard' : 'good');
  const mood = $derived(phase === 'flipped' ? 'think' : moodFor(result, streak));
  const verdictTitle = $derived(phase === 'flipped' ? 'Как вспомнилось?' : !result ? '' : !result.correct ? 'Не то' : result.typo ? 'Опечатка' : streak > 0 && streak % 5 === 0 ? 'Пять подряд' : 'Верно');
  const verdictLine = $derived.by(() => {
    const g = selected ?? suggested;
    const when = intervals ? `через ${intervals[g]}` : '';
    const chosen = `${selected !== null && selected !== suggested ? 'вы выбрали' : 'авто'}: ${GRADE_NAME[g]}${when ? ', ' + when : ''}`;
    if (phase === 'flipped') return 'Оцени, насколько легко вспомнилось';
    if (result && !result.correct && result.expected) return `Правильно: ${result.expected} · ${chosen}`;
    if (result?.typo) return `Засчитано как «${GRADE_NAME[g]}»${when ? ' · ' + when : ''}`;
    return chosen;
  });
  const letters = $derived(result?.typo && given && result.expected ? typoLetters(given.trim(), result.expected) : []);
  const segColor = (i: number) => (i === index && phase === 'answer' ? 'cur' : results[i] ?? (i < index ? 'good' : 'todo'));

  const modeLabel = $derived(item ? ({ intro: 'Новое', learn: 'Изучение', review: 'Повторение', practice: 'Практика' } as const)[item.mode] : '');
  const progressPct = $derived(queue.length ? `${(index / queue.length) * 100}%` : '0%');
  const timeTo = (d: Date) => formatInterval(new Date(), d);
</script>

<div class="narrow session">
  {#if phase === 'done' || phase === 'wait'}
    <section class="finish" in:fly={{ y: 12, duration: 400, opacity: 1 }}>
      <div class="hero-pic"><Zubrik mood={phase === 'wait' ? 'sleep' : 'cheer'} size={240} /></div>
      <h1 class="display">{phase === 'wait' ? 'Небольшой перерыв' : answered ? 'Сессия пройдена' : 'Сейчас нечего повторять'}</h1>
      {#if finishStats?.streak}
        <p class="streak-line"><svg class="flame zb-a" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg><span><b>{finishStats.streak} {plural(finishStats.streak, 'день', 'дня', 'дней')}</b> подряд</span></p>
      {/if}
      {#if answered}
        <div class="result num" style="animation: zb-rise 320ms 200ms var(--ease-out) both">
          <div><b>{answered}</b><span>{plural(answered, 'задание', 'задания', 'заданий')}</span></div>
          <div><b class="good">{Math.round((correct / answered) * 100)}%</b><span>верно</span></div>
          <div><b>{Math.max(1, Math.round((Date.now() - startedAt) / 60000))}′</b><span>минут</span></div>
          <div><b>{introduced}</b><span>новых</span></div>
        </div>
      {/if}
      {#if nextDue}
        <div class="say" style="animation: zb-rise 320ms 280ms var(--ease-out) both">
          <span class="avatar small">{#if app.mascotMode !== 'off'}<Zubrik mood="hello" size={34} crop="head" phase={1800} />{/if}</span>
          <div class="bubble">Следующее повторение через {timeTo(nextDue)}.</div>
        </div>
      {/if}
      <div class="actions">
        {#if phase === 'wait'}<button class="btn block" type="button" onclick={() => start(LEARN_AHEAD)}>Продолжить сейчас</button>{/if}
        <a class="btn block" class:ghost={phase === 'wait'} href="#/">Готово</a>
      </div>
    </section>
  {:else if item}
    <div class="head">
      <a class="close" href="#/" aria-label="Закончить сессию"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></a>
      <div class="segs" role="progressbar" aria-valuemin="0" aria-valuemax={queue.length} aria-valuenow={index}>
        {#each queue as q, i (q.key)}<span class="seg {segColor(i)}"></span>{/each}
      </div>
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
    {#if goalReached}
      <button class="goal-done" type="button" onclick={() => (goalReached = false)} aria-label="Норма на сегодня выполнена. Скрыть">
        {#if app.mascotMode !== 'off'}<span class="goal-pic"><Zubrik mood="happy" size={44} crop="head" /></span>{/if}
        <span><b>Норма на сегодня выполнена</b><span>{app.goal} заданий — можно закончить или продолжить.</span></span>
      </button>
    {/if}
    {#if notice}<p class="notice">{notice}</p>{/if}

    <div class="kicker">
      {#if item.mode === 'intro'}
        <span class="chip amber">Новое {item.card.kind === 'grammar' ? 'правило' : 'слово'}</span>
      {:else}
        <span class="kname">{item.mode === 'practice' ? 'Практика · ' : ''}{exerciseName}</span>
        <span class="skills">{#each item.skills as s (s)}<span class="chip">{s}</span>{/each}</span>
      {/if}
    </div>

    {#key item.key}
      <div class="step" in:fly={{ y: 14, duration: 320, opacity: 1 }}>
        {#if phase === 'answer' || phase === 'reveal'}<article class="exercise" class:flipping>
          {#if rendered && 'error' in rendered}
            <p class="err">{rendered.error}</p>
            <button class="btn small ghost" type="button" onclick={advance}>Пропустить</button>
          {:else if rendered}
            <ExerciseFrame bind:this={frame} srcdoc={rendered.srcdoc} {onevent} name="exercise" />
          {/if}
        </article>{/if}
      </div>
    {/key}

    {#if (phase === 'graded' || phase === 'flipped') && extra && (extra.explanation || extra.translation || (extra.sentence && (phase === 'flipped' || result?.correct)))}
      <div class="explain surface" in:flipIn={{ duration: 320 }}>
        {#if extra.sentence && (phase === 'flipped' || result?.correct)}<p class="sentence">{extra.sentence}</p>{/if}
        {#if extra.translation}<p class="muted">{extra.translation}</p>{/if}
        {#if extra.explanation}<div class="md">{@html extra.explanation}</div>{/if}
      </div>
    {/if}
    {#if (phase === 'graded' || phase === 'flipped') && backRendered && 'srcdoc' in backRendered}
      <section class="back surface" in:flipIn={{ duration: 340, delay: 60 }}>{#key item.key}<InlineView html={backRendered.html} css={backRendered.css} onplay={playNow} />{/key}</section>
    {/if}

    {#if phase === 'reveal' || phase === 'graded' || phase === 'flipped'}
      <div class="sheet {tone}" in:fly={{ y: 200, duration: 280, opacity: 1, easing: (t) => 1 - Math.pow(1 - t, 3) }}>
        <div class="verdict">
          <span class="avatar">
            {#if app.mascotMode === 'off'}
              <svg class="res-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={tone === 'bad' ? 'M6 6l12 12M18 6 6 18' : 'M5 12l5 5 9-10'} /></svg>
            {:else}
              {#key index}<Zubrik {mood} size={54} crop="head" />{/key}
            {/if}
          </span>
          <div class="vtext">
            {#if verdictTitle}<b>{verdictTitle}</b>{/if}
            <span>{verdictLine}</span>
            {#if practice}<span class="small">Ответ уже встречался в этом цикле — засчитано как практика</span>{/if}
          </div>
        </div>
        {#if letters.length}
          <div class="letters" aria-label="Правильное написание">
            {#each letters as l, i (i)}<span class:fix={l.fix} style={l.fix ? 'animation: zb-pop 300ms 260ms var(--ease-spring) both' : ''}>{l.ch === ' ' ? '\u00a0' : l.ch}</span>{/each}
          </div>
        {/if}
        {#if phase === 'reveal'}
          <button class="btn block flip-btn sheet-btn" type="button" onclick={flipNow}>Перевернуть</button>
        {:else}
          {#if item.mode !== 'intro' && !item.topicCards}
            <GradeBar selected={selected} auto={phase === 'flipped' ? null : suggested} {intervals} onpick={(g) => (selected = g)} />
          {/if}
          <button class="btn block sheet-btn" type="button" onclick={() => grade(selected ?? suggested)}>Дальше</button>
        {/if}
      </div>
    {:else if item.mode !== 'intro' && phase === 'answer'}
      <div class="tools">
        {#if history.length}<button class="link" type="button" onclick={undo}>← Отменить ответ</button>{/if}
        <button class="btn ghost dontknow" type="button" onclick={giveUp}>Не знаю</button>
        <button class="link" type="button" onclick={skip}>Пропустить</button>
      </div>
    {/if}
    {#if saveError}<p class="toast">{saveError}</p>{/if}
  {/if}
</div>

<style>
  .session { padding-top: 8px; padding-bottom: 16px; min-height: calc(100vh - 140px); display: flex; flex-direction: column; }
  .head { display: flex; align-items: center; gap: 10px; }
  .close { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; color: var(--ink-2); flex: none; }
  .close:hover { background: var(--soft); }
  .close svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2.2; fill: none; stroke-linecap: round; }
  .segs { flex: 1; display: flex; gap: 3px; min-width: 0; }
  .seg { flex: 1; height: 6px; border-radius: 3px; background: var(--line); transition: background-color 200ms var(--ease); }
  .seg.good { background: var(--brand); } .seg.bad { background: var(--again); } .seg.hard { background: var(--hard); }
  .seg.cur { background: var(--amber); transform-origin: 0 50%; animation: zb-grow 280ms var(--ease) both; }
  .count { font: 400 13px/1 var(--font-mono); color: var(--ink-3); min-width: 40px; text-align: right; }
  .kicker { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 14px 4px 12px; min-height: 26px; }
  .kname { font-size: 15px; font-weight: 600; color: var(--ink-2); }
  .skills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .chip.amber { background: var(--amber-soft); color: var(--amber-ink); font: 600 13px/1 var(--font-body); height: 26px; }
  .small { font-size: 13px; }
  .exercise { min-height: 200px; transform-origin: 50% 100%; }
  .exercise.flipping { animation: flip-out .22s cubic-bezier(.4, 0, 1, 1) forwards; }
  @keyframes flip-out { to { transform: perspective(1400px) rotateX(88deg); } }
  .err { color: var(--again); }
  .tools { margin-top: auto; padding-top: 16px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .tools .dontknow { grid-column: 1 / -1; width: 100%; }
  .link { background: none; border: 0; color: var(--ink-3); font-size: 14px; cursor: pointer; padding: 8px 4px; border-radius: 8px; }
  .link:hover { color: var(--ink); }
  .explain { margin-top: 4px; padding: 16px 20px; display: grid; gap: 6px; font-size: 15px; }
  .explain p { margin: 0; }
  .explain .sentence { font-size: 18px; font-weight: 500; }
  .explain .md { color: var(--ink-2); }
  .back { margin-top: 10px; padding: 18px 20px 20px; }

  .sheet { --tint: var(--card); --tone: var(--ink); --edge: var(--accent-edge); position: sticky; bottom: 0; z-index: 6; margin: auto -16px 0; margin-top: 16px; padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px)); border-radius: 20px 20px 0 0; background: var(--tint); display: grid; gap: 14px; border-top: 1px solid var(--line); }
  .sheet.good { --tint: var(--good-bg); --tone: var(--good); --edge: var(--good-deep); border-top-color: var(--good-bg); }
  .sheet.bad { --tint: var(--again-bg); --tone: var(--again); --edge: var(--again-deep); border-top-color: var(--again-bg); }
  .sheet.hard { --tint: var(--hard-bg); --tone: var(--hard); --edge: var(--hard-deep); border-top-color: var(--hard-bg); }
  .verdict { display: flex; align-items: center; gap: 12px; }
  .avatar { flex: none; width: 56px; height: 56px; border-radius: 50%; background: var(--avatar); overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
  .avatar.small { width: 36px; height: 36px; background: var(--soft); }
  .res-icon { width: 28px; height: 28px; margin: auto; fill: none; stroke: var(--tone); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; animation: zb-pop 260ms var(--ease-spring) both; }
  .vtext { display: grid; gap: 2px; min-width: 0; }
  .vtext b { font: 600 19px/1.2 var(--font-display); color: var(--tone); }
  .vtext span { font-size: 14px; color: var(--tone); }
  .letters { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; }
  .letters span { width: 34px; height: 44px; border-radius: 8px; background: var(--card); font: 400 21px/1 var(--font-mono); display: flex; align-items: center; justify-content: center; color: var(--ink); }
  .letters span.fix { background: var(--good); color: var(--on-grade); font-weight: 500; }
  .sheet-btn { background: var(--tone); color: var(--on-grade); box-shadow: 0 2px 0 var(--edge); }
  .sheet.neutral .sheet-btn { background: var(--accent); color: var(--on-accent); box-shadow: 0 2px 0 var(--accent-edge); }
  .sheet-btn:hover { background: var(--tone); filter: brightness(1.05); }

  .menu-wrap { position: relative; }
  .more { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--paper); display: grid; place-items: center; cursor: pointer; color: var(--ink-3); }
  .more:hover { background: var(--soft); color: var(--ink); }
  .more svg { width: 18px; height: 18px; fill: currentColor; }
  .menu { position: absolute; right: 0; top: 42px; z-index: 20; min-width: 240px; display: grid; padding: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  .menu button, .menu a { display: flex; justify-content: space-between; gap: 12px; text-align: left; padding: 11px 12px; border: 0; border-radius: 9px; background: var(--card); font-size: 14px; color: var(--ink); text-decoration: none; cursor: pointer; }
  .menu button:hover:not(:disabled), .menu a:hover { background: var(--soft); }
  .menu button:disabled { color: var(--ink-3); cursor: default; }
  .kbd { align-self: center; font: 400 11px/1.4 var(--font-mono); color: var(--ink-3); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
  @media (hover: none) { .kbd { display: none; } }
  .goal-done { width: calc(100% - 8px); margin: 10px 4px 0; padding: 8px 14px 8px 8px; border: 0; border-radius: 14px; background: var(--good-bg); color: var(--good); display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer; font: inherit; animation: zb-rise 280ms var(--ease-out) both; }
  .goal-done > span:last-child { display: grid; gap: 2px; }
  .goal-done b { font: 600 15px/1.2 var(--font-display); }
  .goal-done span span { font-size: 13px; color: var(--ink-2); }
  .goal-pic { flex: none; width: 48px; height: 48px; border-radius: 50%; background: var(--card); overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
  .notice { margin: 10px 4px 0; padding: 10px 14px; border-radius: 12px; background: var(--amber-soft); color: var(--ink); font-size: 14px; }
  .toast { margin: 12px 4px 0; font-size: 13px; color: var(--again); }

  .finish { display: grid; gap: 0; padding-top: 8px; }
  .hero-pic { height: 300px; border-radius: 20px; background: var(--soft); overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
  .finish h1 { margin: 24px 4px 10px; }
  .streak-line { margin: 0 4px; display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--ink-2); }
  .streak-line b { color: var(--ink); }
  .flame { width: 20px; height: 20px; fill: var(--amber); transform-origin: 50% 100%; animation: zb-flame 600ms 700ms var(--ease-spring) 1 both; }
  .result { margin-top: 22px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
  .result div { padding: 14px 12px; display: grid; gap: 2px; }
  .result div + div { border-left: 1px solid var(--line); }
  .result b { font: 600 22px/1.1 var(--font-display); }
  .result b.good { color: var(--good); }
  .result span { font-size: 12px; color: var(--ink-3); }
  .say { margin-top: 12px; display: flex; gap: 10px; align-items: flex-start; }
  .bubble { flex: 1; background: var(--card); border: 1px solid var(--line); border-radius: 4px 12px 12px 12px; padding: 10px 12px; font-size: 14px; line-height: 1.45; }
  .actions { margin-top: 24px; display: grid; gap: 10px; }
</style>
