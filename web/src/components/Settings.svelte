<script lang="ts">
  import Connect from './Connect.svelte';
  import { app, backend, setDevice, setGoal, setRepo, setTheme, STANDALONE, sync, reload } from '../lib/state.svelte';
  import { mediaUrl } from '../lib/render';

  let device = $state(app.device);
  let log = $state('');
  let downloading = $state('');

  async function runSync() { log = await sync(); }

  async function downloadAudio() {
    const urls = app.data!.topics.flatMap((t) => t.cards).flatMap((c) => [c.content.audio, ...(c.content.examples ?? []).map((e) => e.audio)].filter(Boolean).map((f) => mediaUrl(c, f!)));
    let done = 0;
    for (const u of urls) {
      await backend().media(u).catch(() => '');
      done += 1;
      downloading = `${done}/${urls.length}`;
    }
    downloading = `Скачано ${urls.length} файлов — аудио доступно офлайн.`;
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

  <section class="panel box">
    <h2>Тема</h2>
    <div class="seg" role="radiogroup" aria-label="Тема">
      {#each [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']] as const as [value, label] (value)}
        <button type="button" role="radio" aria-checked={app.theme === value} class:on={app.theme === value} onclick={() => setTheme(value)}>{label}</button>
      {/each}
    </div>
  </section>

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
    {#if backend().kind === 'github'}
      <p class="muted">Колода <span class="mono">{app.repo?.owner}/{app.repo?.repo}</span>. Прогресс сохраняется на устройстве и отправляется коммитом: автоматически через пару минут после ответов, при сворачивании приложения и по кнопке.</p>
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
    <p class="muted">Каждое устройство пишет свой журнал: <span class="mono">journal/&lt;месяц&gt;/{app.device}.tsv</span>, поэтому синхронизация не даёт конфликтов.</p>
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
    <h2>Проверка колоды</h2>
    <p class="muted">Отрендерить каждое задание, решить его эталонным ответом и проверить аудиофайлы.</p>
    <a class="btn ghost" href="#/lint">Проверить колоду</a>
  </section>
</div>

<style>
  .box { padding: 18px; margin-top: 14px; display: grid; gap: 10px; justify-items: start; }
  h2 { font: 600 16px/1.3 var(--font-body); margin: 0; }
  p { font-size: 14px; margin: 0; }
  .status { font-size: 12px; color: var(--ink-3); }
  .seg { display: inline-flex; gap: 4px; padding: 4px; background: var(--soft); border-radius: 12px; }
  .seg button { border: 0; background: var(--soft); padding: 8px 14px; cursor: pointer; font-size: 14px; border-radius: 9px; color: var(--ink-2); transition: background-color .2s, color .2s; }
  .seg button.on { background: var(--card); color: var(--ink); }
  .row { display: flex; gap: 8px; width: 100%; }
  input { flex: 1; min-width: 0; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); font-size: 14px; }
  .log { white-space: pre-wrap; font-size: 12px; background: var(--soft); padding: 10px; border-radius: 8px; margin: 0; width: 100%; }
  .switch { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .btn.active { border-color: var(--ink); background: var(--soft); }
</style>
