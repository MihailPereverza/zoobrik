<script lang="ts">
  import { testConnection } from '../lib/backend';
  import { app, reload, setRepo, STANDALONE } from '../lib/state.svelte';

  let { compact = false }: { compact?: boolean } = $props();
  let repoName = $state(app.repo ? `${app.repo.owner}/${app.repo.repo}` : '');
  let branch = $state(app.repo?.branch ?? 'main');
  let token = $state(app.repo?.token ?? '');
  let busy = $state(false);
  let error = $state('');

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    const [owner, repo] = repoName.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
    if (!owner || !repo) { error = 'Укажите репозиторий в виде владелец/название.'; return; }
    busy = true; error = '';
    const cfg = { owner, repo, branch: branch.trim() || 'main', token: token.trim() };
    try {
      await testConnection(cfg);
      setRepo(cfg);
      await reload();
      location.hash = '#/';
    } catch (e) { error = (e as Error).message; }
    busy = false;
  }

  function disconnect() {
    setRepo(null, STANDALONE ? 'github' : 'server');
    reload();
  }
</script>

<form class="connect" class:compact onsubmit={connect}>
  {#if !compact}
    <b class="title">Подключить GitHub</b>
    <p class="muted">Репозиторий — библиотека колод: колода в корне или папки <span class="mono">decks/&lt;имя&gt;/</span>. Приложение скачивает её на телефон, работает офлайн и отправляет прогресс обратно коммитами.</p>
  {/if}
  <label for="repo">Репозиторий<input id="repo" bind:value={repoName} placeholder="owner/my-decks" autocomplete="off" autocapitalize="off" spellcheck="false" required /></label>
  <label for="branch">Ветка<input id="branch" bind:value={branch} autocapitalize="off" /></label>
  <label for="token">Токен доступа<input id="token" type="password" bind:value={token} placeholder="github_pat_…" autocomplete="off" required /></label>
  <details class="help">
    <summary>Как получить токен</summary>
    <ol>
      <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
      <li>Repository access: <b>Only select repositories</b> → репозиторий с колодами.</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
      <li>Скопируйте токен сюда. Он хранится только на этом устройстве.</li>
    </ol>
  </details>
  {#if error}<p class="error">{error}</p>{/if}
  <div class="row">
    <button class="btn" type="submit" disabled={busy}>{busy ? 'Проверяю…' : app.repo ? 'Сохранить' : 'Подключить'}</button>
    {#if app.repo}<button class="btn ghost" type="button" onclick={disconnect}>Отключить</button>{/if}
  </div>
</form>

<style>
  .connect { display: grid; gap: 14px; max-width: 520px; }
  .title { font: 600 18px/1.2 var(--font-display); }
  p { margin: 0; }
  label { display: grid; gap: 6px; font-size: 14px; color: var(--ink-2); }
  input { font: 400 15px/1.3 var(--font-body); padding: 11px 12px; border-radius: 10px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); }
  input:focus { outline: none; border-color: var(--ink); }
  .help { font-size: 14px; color: var(--ink-2); }
  .help summary { cursor: pointer; color: var(--ink); }
  .help ol { padding-left: 1.2em; display: grid; gap: 4px; }
  .error { color: var(--again); font-size: 14px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
