<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { addDeck, availableStores, defaultStore, fetchLink, readPackageFile, STORE_NAME } from '../lib/library';
  import { PACKAGE_EXT, previewDeck, type DeckPreview, type Fetched, type PackageFile } from '../lib/package';
  import { plural } from '../lib/activity';
  import type { StoreKind } from '../lib/backend';

  let { query = '' }: { query?: string } = $props();
  const fromLink = new URLSearchParams(untrack(() => query)).get('src') ?? '';

  let link = $state(fromLink);
  let busy = $state('');
  let error = $state('');
  let files = $state.raw<PackageFile[] | null>(null);
  let source = $state<Fetched['source'] | null>(null);
  let preview = $state<DeckPreview | null>(null);
  let store = $state<StoreKind>(defaultStore());
  let progress = $state('');
  let input = $state<HTMLInputElement>();

  const stores = availableStores();
  const onProgress = (done: number, total: number) => { progress = `${done} из ${total}`; };
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1e3))} КБ`);

  function accept(list: PackageFile[], src: Fetched['source'] | null) {
    preview = previewDeck(list);
    files = list;
    source = src;
  }

  async function run(label: string, task: () => Promise<void>) {
    busy = label; error = ''; progress = '';
    try { await task(); } catch (e) { error = (e as Error).message; }
    busy = '';
  }

  // GitHub decks keep their audio at the source when stored in the GitHub library: copying it would cost one API call per file.
  const loadLink = () => run('Загружаю колоду…', async () => {
    const r = await fetchLink(link, { media: store !== 'github', onProgress });
    accept(r.files, r.source);
  });

  const loadFile = (file: File) => run('Читаю файл…', async () => accept(await readPackageFile(file), null));

  const confirm = () => run('Добавляю…', async () => {
    await addDeck(files!, source ? { ...source } : null, store, onProgress);
    location.hash = '#/';
  });

  function reset() { files = null; preview = null; source = null; error = ''; }

  onMount(() => { if (fromLink) loadLink(); });
</script>

<div class="wrap narrow">
  <a class="back" href="#/decks">← Колоды</a>
  <h1 class="display page">Добавить колоду</h1>

  {#if !preview}
    <section class="panel opt">
      <h2>Из файла</h2>
      <p class="muted">Файл <span class="mono">{PACKAGE_EXT}</span> — колода целиком, с озвучкой. Так колодой делятся без GitHub.</p>
      <input bind:this={input} class="hidden" type="file" accept="{PACKAGE_EXT},.zip,application/zip" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) loadFile(f); }} />
      <button class="btn block" type="button" disabled={!!busy} onclick={() => input?.click()}>Выбрать файл</button>
    </section>

    <section class="panel opt">
      <h2>По ссылке</h2>
      <p class="muted">Репозиторий на GitHub (<span class="mono">owner/repo</span>, адрес страницы или папки) или прямая ссылка на файл.</p>
      <form onsubmit={(e) => { e.preventDefault(); loadLink(); }}>
        <input class="field" bind:value={link} placeholder="github.com/owner/repo" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Ссылка на колоду" />
        <button class="btn block ghost" type="submit" disabled={!!busy || !link.trim()}>Открыть</button>
      </form>
    </section>
  {:else}
    <section class="panel preview">
      <div class="head">
        <div>
          <h2>{preview.name}</h2>
          <span class="mono muted">{preview.lang}</span>
        </div>
      </div>
      {#if preview.description}<p class="muted">{preview.description}</p>{/if}
      <dl class="facts">
        <div><dt>{plural(preview.cards, 'карточка', 'карточки', 'карточек')}</dt><dd class="num">{preview.cards}</dd></div>
        <div><dt>{plural(preview.exercises, 'задание', 'задания', 'заданий')}</dt><dd class="num">{preview.exercises}</dd></div>
        <div><dt>{source?.media ? 'озвучка из источника' : plural(preview.media, 'файл озвучки', 'файла озвучки', 'файлов озвучки')}</dt><dd class="num">{source?.media ? '✓' : preview.media}</dd></div>
        <div><dt>размер</dt><dd class="num">{size(preview.bytes)}</dd></div>
      </dl>
      {#if preview.scripts}<p class="warn">В колоде есть свои скрипты ({preview.scripts}). Они работают в изолированной рамке и не видят ваших данных, но добавляйте колоды только из источников, которым доверяете.</p>{/if}
      {#if app.decks.some((d) => d.name === preview!.name)}<p class="warn">Колода с таким названием уже есть — эта добавится рядом, прогресс у них раздельный.</p>{/if}

      {#if stores.length > 1}
        <div class="where" role="radiogroup" aria-label="Где хранить">
          <span class="muted">Где хранить</span>
          <div class="seg">
            {#each stores as s (s)}<button type="button" role="radio" aria-checked={store === s} class:on={store === s} onclick={() => (store = s)}>{STORE_NAME[s]}</button>{/each}
          </div>
          <span class="hint muted">{store === 'github' ? 'Папка decks/ в вашем репозитории: прогресс синхронизируется между устройствами.' : store === 'local' ? 'Только в этом браузере, без синхронизации. Удобно, чтобы попробовать.' : 'Папка decks/ рядом с основной колодой.'}</span>
        </div>
      {/if}
      <div class="row">
        <button class="btn block" type="button" disabled={!!busy} onclick={confirm}>Добавить</button>
        <button class="btn ghost" type="button" disabled={!!busy} onclick={reset}>Назад</button>
      </div>
    </section>
  {/if}

  {#if busy}<p class="status muted" role="status">{busy} {progress}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .back { display: inline-block; margin: 8px 4px 0; color: var(--ink-2); font-size: 14px; text-decoration: none; }
  .page { margin-top: 6px; }
  .opt, .preview { padding: 18px; display: grid; gap: 10px; margin-top: 12px; }
  h2 { margin: 0; font: 600 18px/1.2 var(--font-display); }
  p { margin: 0; font-size: 14px; line-height: 1.45; }
  .hidden { display: none; }
  form { display: grid; gap: 10px; }
  .field { font: 400 15px/1.3 var(--font-mono); padding: 13px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); min-width: 0; }
  .field:focus { outline: none; border-color: var(--ink); }
  .head h2 { font-size: 22px; }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 4px 0; }
  .facts div { background: var(--paper); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column-reverse; gap: 2px; }
  .facts dt { font-size: 13px; color: var(--ink-2); }
  .facts dd { margin: 0; font: 600 20px/1.1 var(--font-display); }
  .warn { background: var(--amber-soft); color: var(--amber-ink); padding: 10px 12px; border-radius: 12px; }
  .where { display: grid; gap: 6px; }
  .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: var(--soft); }
  .seg button { height: 40px; border: 0; border-radius: 9px; background: none; color: var(--ink-2); font: 500 14px/1 var(--font-body); cursor: pointer; }
  .seg button.on { background: var(--card); color: var(--ink); font-weight: 600; box-shadow: 0 1px 0 var(--line); }
  .hint { font-size: 13px; }
  .row { display: flex; gap: 8px; margin-top: 4px; }
  .row .block { flex: 1; }
  .status { margin: 14px 4px; }
  .error { margin: 14px 4px; color: var(--again); font-size: 14px; }
</style>
