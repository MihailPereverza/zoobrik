<script lang="ts">
  import { onMount } from 'svelte';
  import { app, needsSetup, reload, setTheme, sync } from './lib/state.svelte';
  import Connect from './components/Connect.svelte';
  import Home from './components/Home.svelte';
  import Session from './components/Session.svelte';
  import TopicView from './components/TopicView.svelte';
  import CardView from './components/CardView.svelte';
  import Stats from './components/Stats.svelte';
  import Settings from './components/Settings.svelte';
  import Lint from './components/Lint.svelte';

  let route = $state(location.hash.slice(1) || '/');
  onMount(() => {
    reload();
    const onHash = () => { route = location.hash.slice(1) || '/'; window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const parts = $derived(route.split('/').filter(Boolean));
  const section = $derived(parts[0] ?? '');
  const themes = [['system', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']] as const;
  const nextTheme = () => {
    const order = ['system', 'light', 'dark'] as const;
    setTheme(order[(order.indexOf(app.theme) + 1) % 3]);
  };
</script>

<header class="top">
  <div class="wrap bar">
    <a class="brand" href="#/">Zoobrik</a>
    <nav>
      <a href="#/" class:on={section === ''}>Учить</a>
      <a href="#/stats" class:on={section === 'stats'}>Статистика</a>
      <a href="#/settings" class:on={section === 'settings'}>Настройки</a>
    </nav>
    {#if app.mode === 'github' && app.repo}
      <button class="sync" type="button" onclick={() => sync()} title={app.syncMessage || 'Синхронизировать'} aria-label="Синхронизировать" class:busy={app.syncing}>
        <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18 3v4.5h-4.5M6 21v-4.5h4.5" /></svg>
        {#if app.pending}<i class="dot" class:offline={!app.online}></i>{/if}
      </button>
    {/if}
    <button class="theme" type="button" onclick={nextTheme} title="Тема: {themes.find((t) => t[0] === app.theme)?.[1]}" aria-label="Сменить тему">
      {#if app.effectiveTheme === 'dark'}
        <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
      {:else}
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>
      {/if}
      {#if app.theme === 'system'}<small>A</small>{/if}
    </button>
  </div>
</header>

<main>
  {#if needsSetup()}
    <div class="narrow"><Connect /></div>
  {:else if app.error}
    <div class="narrow error panel appear">
      <b>Не удалось загрузить колоду.</b>
      <p class="mono">{app.error}</p>
      <button class="btn small" type="button" onclick={reload}>Повторить</button>
    </div>
  {:else if !app.data}
    <div class="narrow loading muted">Загружаю колоду…</div>
  {:else if section === 'session'}
    <Session />
  {:else if section === 'topic' && parts[1]}
    <TopicView topicId={parts[1]} />
  {:else if section === 'card' && parts[2]}
    <CardView topicId={parts[1]} cardId={parts[2]} />
  {:else if section === 'stats'}
    <Stats />
  {:else if section === 'settings'}
    <Settings />
  {:else if section === 'lint'}
    <Lint />
  {:else}
    <Home />
  {/if}
</main>

<style>
  .top { position: sticky; top: 0; z-index: 10; background: var(--paper); padding-top: env(safe-area-inset-top, 0px); }
  .bar { display: flex; align-items: center; gap: 18px; height: 56px; max-width: 1000px; }
  .brand { font: 600 16px/1 var(--font-body); text-decoration: none; letter-spacing: -.01em; }
  nav { display: flex; gap: 18px; margin-left: auto; }
  nav { gap: 4px; }
  nav a { text-decoration: none; font-size: 14px; color: var(--ink-3); padding: 7px 12px; border-radius: 999px; transition: background-color .2s, color .2s; }
  nav a:hover { color: var(--ink); }
  nav a.on { color: var(--ink); background: var(--card); border: 1px solid var(--line); }
  nav a { border: 1px solid var(--paper); }
  .theme, .sync { position: relative; width: 32px; height: 32px; border-radius: 8px; border: 0; background: var(--paper); display: grid; place-items: center; cursor: pointer; color: var(--ink-3); }
  .theme:hover, .sync:hover { color: var(--ink); background: var(--soft); }
  .theme, .sync { border-radius: 50%; transition: background-color .2s, color .2s; }
  .theme svg, .sync svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .theme small { display: none; }
  .sync.busy svg { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sync .dot { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--again); }
  .sync .dot.offline { background: var(--ink-3); }
  main { padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px)); }
  .error, .loading { margin-top: 40px; }
  .error { padding: 18px; }
  .loading { text-align: center; }
  @media (max-width: 520px) { .bar { gap: 6px; } nav a { padding: 7px 9px; font-size: 13px; } }
</style>
