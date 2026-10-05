<script lang="ts">
  import { app, reload, setDevice, setTheme } from '../lib/state.svelte';
  import { syncDeck } from '../lib/api';

  let device = $state(app.device);
  let syncing = $state(false);
  let log = $state('');

  async function sync() {
    syncing = true; log = '';
    try {
      const res = await syncDeck(app.device);
      log = res.log || 'Готово.';
      await reload();
    } catch (e) { log = (e as Error).message; }
    syncing = false;
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
    <h2>Имя устройства</h2>
    <p class="muted">Каждое устройство пишет свой журнал ответов: <span class="mono">journal/&lt;месяц&gt;/{app.device}.tsv</span>. Так синхронизация не даёт конфликтов.</p>
    <div class="row">
      <input id="device" class="mono" bind:value={device} aria-label="Имя устройства" />
      <button class="btn small" type="button" onclick={() => setDevice(device)} disabled={device === app.device}>Сохранить</button>
    </div>
  </section>

  <section class="panel box">
    <h2>Проверка колоды</h2>
    <p class="muted">Отрендерить каждое задание, решить его эталонным ответом и проверить, что все аудиофайлы на месте.</p>
    <a class="btn ghost" href="#/lint">Проверить колоду</a>
  </section>

  <section class="panel box">
    <h2>Синхронизация через GitHub</h2>
    <p class="muted">Колода — git-репозиторий. Кнопка делает коммит с прогрессом и журналом, затем <span class="mono">pull --rebase</span> и <span class="mono">push</span>, если настроен remote.</p>
    <button class="btn" type="button" onclick={sync} disabled={syncing}>{syncing ? 'Синхронизирую…' : 'Синхронизировать'}</button>
    {#if log}<pre class="mono log">{log}</pre>{/if}
  </section>
</div>

<style>
  .box { padding: 18px; margin-top: 14px; }
  h2 { font: 600 16px/1.3 var(--font-body); margin: 0 0 8px; }
  p { font-size: 14px; margin: 0 0 12px; }
  .seg { display: inline-flex; border: 1px solid var(--rule-strong); border-radius: 9px; overflow: hidden; }
  .seg button { border: 0; background: var(--card); padding: 9px 14px; cursor: pointer; font-size: 14px; }
  .seg button + button { border-left: 1px solid var(--rule-strong); }
  .seg button.on { background: var(--ink); color: var(--card); }
  .row { display: flex; gap: 8px; }
  input { flex: 1; min-width: 0; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); font-size: 14px; }
  .log { white-space: pre-wrap; font-size: 12px; background: var(--soft); padding: 10px; border-radius: 8px; margin: 12px 0 0; }
</style>
