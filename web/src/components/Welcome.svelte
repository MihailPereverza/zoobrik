<script lang="ts">
  import Connect from './Connect.svelte';
  import Zubrik from './Zubrik.svelte';
  import { app } from '../lib/state.svelte';

  let github = $state(false);
</script>

<div class="wrap narrow welcome">
  <div class="hero appear">
    <Zubrik mood="hello" size={150} />
    <h1 class="display">Привет! Я Зубрик.</h1>
    <p class="muted">Помогаю учить слова и грамматику: каждый день немного, и с повторением в нужный момент. Начнём с колоды.</p>
  </div>

  <a class="panel opt appear" href="#/add">
    <b>Добавить колоду</b>
    <span class="muted">Из файла <span class="mono">.zoobrik</span> или по ссылке на GitHub. Можно без регистрации — колода будет на этом устройстве.</span>
  </a>

  {#if app.repo}
    <div class="panel opt static appear">
      <b>GitHub подключён</b>
      <span class="muted">В <span class="mono">{app.repo.owner}/{app.repo.repo}</span> пока нет колод. Добавьте колоду — она ляжет в папку <span class="mono">decks/</span> и будет синхронизироваться между устройствами.</span>
    </div>
  {:else if github}
    <div class="panel opt static appear"><Connect /></div>
  {:else}
    <button class="panel opt appear" type="button" onclick={() => (github = true)}>
      <b>Подключить GitHub</b>
      <span class="muted">Репозиторий — ваша библиотека колод: прогресс синхронизируется между телефоном и компьютером, им удобно делиться.</span>
    </button>
  {/if}
</div>

<style>
  .welcome { display: grid; gap: 12px; padding-top: 12px; }
  .hero { display: grid; justify-items: center; text-align: center; gap: 8px; margin-bottom: 8px; }
  .hero h1 { margin: 6px 0 0; }
  .hero p { margin: 0; max-width: 360px; font-size: 15px; line-height: 1.45; }
  .opt { display: grid; gap: 6px; padding: 18px; text-decoration: none; color: var(--ink); text-align: left; border: 1px solid var(--line); background: var(--card); cursor: pointer; font: inherit; box-shadow: 0 2px 0 var(--line); transition: transform 120ms var(--ease); }
  .opt:active:not(.static) { transform: translateY(2px); box-shadow: none; }
  .opt.static { cursor: default; box-shadow: none; }
  .opt b { font: 600 18px/1.2 var(--font-display); }
  .opt .muted { font-size: 14px; line-height: 1.45; }
</style>
