<script lang="ts">
  import { onMount } from 'svelte';
  import { app, needsSetup, reload, sync } from './lib/state.svelte';
  import { dayStats } from './lib/activity';
  import Connect from './components/Connect.svelte';
  import Home from './components/Home.svelte';
  import Topics from './components/Topics.svelte';
  import Session from './components/Session.svelte';
  import TopicView from './components/TopicView.svelte';
  import CardView from './components/CardView.svelte';
  import Stats from './components/Stats.svelte';
  import Settings from './components/Settings.svelte';
  import Lint from './components/Lint.svelte';
  import Zubrik from './components/Zubrik.svelte';

  let route = $state(location.hash.slice(1) || '/');
  onMount(() => {
    reload();
    const onHash = () => { route = location.hash.slice(1) || '/'; window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const parts = $derived(route.split('/').filter(Boolean));
  const section = $derived(parts[0] ?? '');
  const inSession = $derived(section === 'session');
  const streak = $derived(dayStats(app.activity).streak);
  const tabs = [
    { href: '#/', id: '', label: 'Учить', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
    { href: '#/topics', id: 'topics', label: 'Темы', icon: 'M7 3h11a3 3 0 0 1 3 3v11 M3 10a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z' },
    { href: '#/stats', id: 'stats', label: 'Статистика', icon: 'M5 20v-8M12 20V5M19 20v-5' },
    { href: '#/settings', id: 'settings', label: 'Профиль', icon: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21c1-4 4-6 8-6s7 2 8 6' },
  ];
  const activeTab = $derived(['topic', 'card'].includes(section) ? 'topics' : ['lint'].includes(section) ? 'settings' : section);
</script>

{#if !inSession}
  <header class="top">
    <div class="wrap bar">
      <a class="brand" href="#/">зубрик</a>
      {#if streak > 0}
        <span class="streak" title="Дней подряд с занятиями"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg><b class="num">{streak}</b></span>
      {/if}
      {#if app.mode === 'github' && app.repo}
        <button class="icon-btn" type="button" onclick={() => sync()} title={app.syncMessage || 'Синхронизировать'} aria-label="Синхронизировать" class:busy={app.syncing}>
          <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18 3v4.5h-4.5M6 21v-4.5h4.5" /></svg>
          {#if app.pending}<i class="dot" class:offline={!app.online}></i>{/if}
        </button>
      {/if}
      <a class="me" href="#/settings" aria-label="Профиль">
        {#if app.mascotMode === 'off'}
          <svg viewBox="0 0 24 24" class="me-icon"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>
        {:else}
          <Zubrik mood={app.syncing ? 'think' : 'hello'} size={38} crop="head" />
        {/if}
      </a>
    </div>
  </header>
{/if}

<main class:session={inSession}>
  {#if needsSetup()}
    <div class="narrow"><Connect /></div>
  {:else if app.error}
    <div class="narrow error panel appear">
      <b>Не удалось загрузить колоду.</b>
      <p class="mono">{app.error}</p>
      <button class="btn small" type="button" onclick={reload}>Повторить</button>
    </div>
  {:else if !app.data}
    <div class="narrow loading">
      <Zubrik mood="think" size={120} />
      <p class="muted">Загружаю колоду…</p>
    </div>
  {:else if section === 'session'}
    {#key route}<Session practiceTopic={parts[1] === 'practice' ? parts[2] ?? '' : ''} />{/key}
  {:else if section === 'topics'}
    <Topics />
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

{#if !inSession && !needsSetup()}
  <nav class="tabs" aria-label="Разделы">
    {#each tabs as t (t.id)}
      <a href={t.href} class:on={activeTab === t.id} aria-current={activeTab === t.id ? 'page' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>{t.label}
      </a>
    {/each}
  </nav>
{/if}

<style>
  .top { background: var(--paper); padding-top: env(safe-area-inset-top, 0px); }
  .bar { display: flex; align-items: center; gap: 10px; height: 64px; }
  .brand { flex: 1; font: 700 22px/1 var(--font-display); letter-spacing: -.035em; text-decoration: none; color: var(--ink); }
  .streak { height: 36px; padding: 0 12px 0 8px; border-radius: 18px; background: var(--card); border: 1px solid var(--line); display: flex; align-items: center; gap: 4px; font-size: 15px; }
  .streak svg { width: 18px; height: 18px; fill: var(--amber); }
  .streak b { font-weight: 600; }
  .icon-btn { position: relative; width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--paper); display: grid; place-items: center; cursor: pointer; color: var(--ink-2); }
  .icon-btn:hover { background: var(--soft); }
  .icon-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .icon-btn.busy svg { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dot { position: absolute; top: 7px; right: 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--amber); }
  .dot.offline { background: var(--ink-3); }
  .me { width: 40px; height: 40px; border-radius: 50%; background: var(--soft); overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
  .me-icon { width: 20px; height: 20px; margin: auto; fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-linecap: round; }
  main { padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)); }
  main.session { padding-bottom: 0; padding-top: env(safe-area-inset-top, 0px); }
  .error, .loading { margin-top: 40px; }
  .error { padding: 18px; }
  .loading { display: grid; justify-items: center; gap: 8px; padding-top: 60px; }
  .tabs { position: fixed; z-index: 15; left: 50%; transform: translateX(-50%); bottom: calc(12px + env(safe-area-inset-bottom, 0px)); width: min(616px, calc(100% - 24px)); background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 6px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
  .tabs a { height: 52px; border-radius: 12px; color: var(--ink-3); text-decoration: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 12px; font-weight: 500; transition: background-color 200ms var(--ease), color 200ms var(--ease); }
  .tabs a svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .tabs a.on { background: var(--soft); color: var(--ink); font-weight: 600; }
</style>
