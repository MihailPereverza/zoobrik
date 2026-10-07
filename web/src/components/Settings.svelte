<script lang="ts">
  import Connect from './Connect.svelte';
  import { activeDeck, app, backend, setDevice, setGoal, setMascot, setMascotMotion, setRepo, setTheme, STANDALONE, sync, reload, THEMES, type MascotMode } from '../lib/state.svelte';
  import Zubrik from './Zubrik.svelte';
  import { audioVariants, mediaUrl } from '../lib/render';
  import { onMount } from 'svelte';
  import { clearLog, logEntries, logText, onLog } from '../lib/log';

  const MODES: Record<MascotMode, { label: string; title: string; note: string; mood: 'happy' | 'hello' | 'sleep' }> = {
    active: { label: 'Активный', title: 'Активный', note: 'Реагирует на ответы и отвечает одной строкой, если на него нажать.', mood: 'happy' },
    quiet: { label: 'Тихий', title: 'Тихий', note: 'Только эмоции в панели проверки и на итогах, без реплик.', mood: 'hello' },
    off: { label: 'Выкл', title: 'Выключен', note: 'Вместо Зубрика — иконка результата. Он остаётся только в иконке приложения.', mood: 'sleep' },
  };
  let device = $state(app.device);
  let log = $state('');
  let downloading = $state('');

  async function runSync() { log = await sync(); }

  async function downloadAudio() {
    const data = app.data!;
    const urls = data.topics.flatMap((t) => t.cards).flatMap((c) => [c.content.audio, ...(c.content.examples ?? []).map((e) => e.audio)]
      .filter(Boolean).flatMap((f) => audioVariants(data, c, f!).map((v) => mediaUrl(c, v))));
    let done = 0;
    for (const u of urls) {
      await backend().media(u).catch(() => '');
      done += 1;
      downloading = `${done}/${urls.length}`;
    }
    downloading = `Скачано ${urls.length} файлов — аудио доступно офлайн.`;
  }

  let logLines = $state(logEntries().slice(-150));
  let copied = $state('');
  onMount(() => onLog(() => { logLines = logEntries().slice(-150); }));

  async function copyLog() {
    const text = `build ${__BUILD__}\n${navigator.userAgent}\n\n${logText()}`;
    try { await navigator.clipboard.writeText(text); copied = 'Скопировано'; }
    catch {
      const area = document.getElementById('log-text') as HTMLTextAreaElement | null;
      if (area) { area.value = text; area.hidden = false; area.select(); }
      copied = 'Выделено — скопируйте вручную';
    }
  }

  let updating = $state(false);
  async function hardUpdate() {
    updating = true;
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches?.keys?.() ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } finally {
      location.reload();
    }
  }

  function useServer(server: boolean) {
    setRepo(app.repo, server ? 'server' : 'github');
    reload();
  }
</script>

<div class="narrow">
  <div class="eyebrow" style="margin-top:32px">Настройки</div>
  <h1 class="display">Устройство и синхронизация</h1>

  <h2 class="section">Зубрик</h2>
  <section class="panel box mascot">
    <div class="m-head">
      <span class="m-avatar">
        {#if app.mascotMode === 'off'}<svg class="m-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
        {:else}<Zubrik mood={MODES[app.mascotMode].mood} size={70} crop="head" />{/if}
      </span>
      <div><b>{MODES[app.mascotMode].title}</b><span class="muted">{MODES[app.mascotMode].note}</span></div>
    </div>
    <div class="seg" role="radiogroup" aria-label="Режим Зубрика">
      {#each Object.entries(MODES) as [id, m] (id)}
        <button type="button" role="radio" aria-checked={app.mascotMode === id} class:on={app.mascotMode === id} onclick={() => setMascot(id as MascotMode)}>{m.label}</button>
      {/each}
    </div>
    <button class="toggle" type="button" aria-pressed={app.mascotMotion} disabled={app.mascotMode === 'off'} onclick={() => setMascotMotion(!app.mascotMotion)}>
      <span><span class="t-label">Анимации маскота</span><span class="t-note">Системное «уменьшить движение» важнее</span></span>
      <span class="track" class:on={app.mascotMotion && app.mascotMode !== 'off'}><span class="knob"></span></span>
    </button>
  </section>

  <h2 class="section">Тема</h2>
  <div class="themes">
    <button type="button" class="theme-tile" aria-pressed={app.theme === 'system'} class:on={app.theme === 'system'} onclick={() => setTheme('system')}>
      <span class="swatch split"><span style="background:#F3F0EA"><i style="background:#33251C"></i></span><span style="background:#141110"><i style="background:#E6DAC4"></i></span></span>
      <span>Как в системе</span>
    </button>
    {#each THEMES as t (t.id)}
      <button type="button" class="theme-tile" aria-pressed={app.theme === t.id} class:on={app.theme === t.id} onclick={() => setTheme(t.id)}>
        <span class="swatch" style:background={t.bg}><i style:background={t.btn}></i></span>
        <span>{t.name}</span>
      </button>
    {/each}
  </div>

  <a class="panel box decks-link" href="#/decks">
    <span><h2>Колоды</h2><span class="muted">{activeDeck()?.name ?? '—'}{app.decks.length > 1 ? ` и ещё ${app.decks.length - 1}` : ''} · добавить, поделиться, обновить</span></span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  </a>

  <section class="panel box">
    <h2>Цель на день</h2>
    <p class="muted">Сколько заданий в день считать выполненной нормой. Кольцо на главной заполняется по мере занятий.</p>
    <div class="seg" role="radiogroup" aria-label="Цель на день">
      {#each [15, 30, 50, 100] as n (n)}
        <button type="button" role="radio" aria-checked={app.goal === n} class:on={app.goal === n} onclick={() => setGoal(n)}>{n}</button>
      {/each}
    </div>
  </section>

  <section class="panel box">
    <h2>Синхронизация</h2>
    {#if backend().kind === 'local'}
      <p class="muted">Текущая колода хранится только в этом браузере и не синхронизируется. Чтобы прогресс был на всех устройствах, подключите GitHub и добавьте колоду туда.</p>
    {:else if backend().kind === 'github'}
      <p class="muted">Библиотека <span class="mono">{app.repo?.owner}/{app.repo?.repo}</span>. Прогресс сохраняется на устройстве и отправляется коммитом: автоматически через пару минут после ответов, при сворачивании приложения и по кнопке.</p>
      <p class="mono status">{app.pending ? `Ждут отправки: ${app.pending} файлов` : 'Всё отправлено'}{app.online ? '' : ' · нет сети'}</p>
    {:else}
      <p class="muted">Локальный режим: прогресс пишется в файлы колоды на этом компьютере. Кнопка делает коммит, <span class="mono">pull --rebase</span> и <span class="mono">push</span>, если у колоды настроен remote.</p>
    {/if}
    <button class="btn" type="button" onclick={runSync} disabled={app.syncing}>{app.syncing ? 'Синхронизирую…' : 'Синхронизировать сейчас'}</button>
    {#if log}<pre class="mono log">{log}</pre>{/if}
  </section>

  <section class="panel box">
    <h2>GitHub</h2>
    <Connect compact />
    {#if !STANDALONE && app.repo}
      <p class="muted switch">Источник колоды:
        <button class="btn small ghost" class:active={app.mode === 'server'} type="button" onclick={() => useServer(true)}>файлы на этом Mac</button>
        <button class="btn small ghost" class:active={app.mode === 'github'} type="button" onclick={() => useServer(false)}>GitHub</button>
      </p>
    {/if}
  </section>

  {#if backend().kind === 'github'}
    <section class="panel box">
      <h2>Офлайн</h2>
      <p class="muted">Тексты колоды уже на устройстве. Аудио скачивается по мере занятий — или всё сразу:</p>
      <button class="btn ghost" type="button" onclick={downloadAudio}>Скачать всё аудио</button>
      {#if downloading}<p class="mono status">{downloading}</p>{/if}
    </section>
  {/if}

  <section class="panel box">
    <h2>Имя устройства</h2>
    <p class="muted">Каждое устройство пишет свой журнал: <span class="mono">{backend().root}journal/&lt;месяц&gt;/{app.device}.tsv</span>, поэтому синхронизация не даёт конфликтов.</p>
    <div class="row">
      <input id="device" class="mono" bind:value={device} aria-label="Имя устройства" />
      <button class="btn small" type="button" onclick={() => setDevice(device)} disabled={device === app.device}>Сохранить</button>
    </div>
  </section>

  <section class="panel box">
    <h2>Версия приложения</h2>
    <p class="muted">Сборка от {__BUILD__} (UTC). Обновления подтягиваются сами при открытии. Если что-то выглядит по-старому — обновите вручную, ваш прогресс и колода сохранятся.</p>
    <button class="btn ghost" type="button" onclick={hardUpdate} disabled={updating}>{updating ? 'Обновляю…' : 'Обновить приложение'}</button>
  </section>

  <section class="panel box">
    <h2>Журнал отладки</h2>
    <p class="muted">Что происходило в приложении: показ заданий, ответы, звук, синхронизация, ошибки. Если что-то не работает, скопируйте журнал и пришлите его.</p>
    <div class="row-btns">
      <button class="btn small" type="button" onclick={copyLog}>Скопировать</button>
      <button class="btn small ghost" type="button" onclick={() => { clearLog(); copied = ''; }}>Очистить</button>
      {#if copied}<span class="muted status">{copied}</span>{/if}
    </div>
    <textarea id="log-text" class="logbox" hidden readonly></textarea>
    <pre class="logview mono">{#each logLines as e, i (i)}<span class:err={/fail|error|rejection/.test(e.msg)}>{e.t} [{e.area}] {e.msg}{e.data === undefined ? '' : ` ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`}</span>
{/each}</pre>
  </section>

  <section class="panel box">
    <h2>Проверка колоды</h2>
    <p class="muted">Отрендерить каждое задание, решить его эталонным ответом и проверить аудиофайлы.</p>
    <a class="btn ghost" href="#/lint">Проверить колоду</a>
  </section>
</div>

<style>
  .decks-link { display: flex !important; align-items: center; justify-content: space-between; text-decoration: none; color: var(--ink); }
  .decks-link > span { display: grid; gap: 4px; }
  .decks-link .muted { font-size: 14px; }
  .decks-link svg { width: 22px; height: 22px; flex: none; fill: none; stroke: var(--ink-3); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .box { padding: 18px; margin-top: 14px; display: grid; gap: 10px; justify-items: start; }
  h2 { font: 600 16px/1.3 var(--font-body); margin: 0; }
  p { font-size: 14px; margin: 0; }
  .status { font-size: 12px; color: var(--ink-3); }
  .mascot { gap: 14px; }
  .m-head { display: flex; gap: 14px; align-items: center; }
  .m-head div { display: grid; gap: 2px; }
  .m-head b { font: 600 17px/1.2 var(--font-display); }
  .m-head span.muted { font-size: 14px; }
  .m-avatar { flex: none; width: 72px; height: 72px; border-radius: 50%; background: var(--soft); overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
  .m-check { width: 32px; height: 32px; margin: auto; fill: none; stroke: var(--good); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 4px 0; border: 0; background: none; text-align: left; cursor: pointer; color: var(--ink); }
  .toggle:disabled { cursor: default; color: var(--ink-3); }
  .toggle > span:first-child { display: grid; gap: 2px; }
  .t-label { font-size: 15px; font-weight: 500; }
  .t-note { font-size: 13px; color: var(--ink-3); }
  .track { flex: none; width: 44px; height: 26px; border-radius: 13px; background: var(--rule-strong); position: relative; transition: background-color 200ms var(--ease); }
  .track.on { background: var(--brand); }
  .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--card); transition: transform 200ms var(--ease); }
  .track.on .knob { transform: translateX(18px); }
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
  .theme-tile { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); cursor: pointer; font-size: 14px; color: var(--ink); text-align: left; }
  .theme-tile.on { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); font-weight: 600; }
  .swatch { height: 56px; border-radius: 10px; border: 1px solid var(--rule-strong); display: flex; align-items: flex-end; padding: 8px; overflow: hidden; }
  .swatch i { display: block; width: 100%; height: 12px; border-radius: 4px; }
  .swatch.split { padding: 0; }
  .swatch.split > span { flex: 1; height: 100%; display: flex; align-items: flex-end; padding: 8px; }
  .seg { display: inline-flex; gap: 4px; padding: 4px; background: var(--soft); border-radius: 12px; }
  .seg button { border: 0; background: var(--soft); padding: 8px 14px; cursor: pointer; font-size: 14px; border-radius: 9px; color: var(--ink-2); transition: background-color .2s, color .2s; }
  .seg button.on { background: var(--card); color: var(--ink); }
  .row { display: flex; gap: 8px; width: 100%; }
  input { flex: 1; min-width: 0; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); font-size: 14px; }
  .row-btns { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .logview { width: 100%; max-height: 320px; overflow: auto; margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--soft); font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .logview .err { color: var(--again); }
  .logbox { width: 100%; height: 120px; font: 11px/1.4 var(--font-mono); background: var(--soft); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; }
  .log { white-space: pre-wrap; font-size: 12px; background: var(--soft); padding: 10px; border-radius: 8px; margin: 0; width: 100%; }
  .switch { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .btn.active { border-color: var(--ink); background: var(--soft); }
</style>
