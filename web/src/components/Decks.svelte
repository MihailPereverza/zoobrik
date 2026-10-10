<script lang="ts">
  import { onMount } from 'svelte';
  import { app, openDeck, reload, setActiveDeck, type DeckRef } from '../lib/state.svelte';
  import { applyUpdate, checkUpdate, exportDeck, readPackageFile, removeDeck, shareLink, STORE_NAME, type UpdateCheck } from '../lib/library';
  import { deckSummary } from '../lib/summary';
  import { plural } from '../lib/activity';
  import { PACKAGE_EXT } from '../lib/package';

  interface Info { due: number; fresh: number }
  let info = $state<Record<string, Info>>({});
  let open = $state('');
  let busy = $state('');
  let progress = $state('');
  let message = $state('');
  let update = $state.raw<{ key: string; check: UpdateCheck } | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let fileFor: DeckRef | null = null;

  const active = $derived(app.deckKey || app.decks[0]?.key);
  const onProgress = (done: number, total: number) => { progress = `${done} из ${total}`; };

  onMount(async () => {
    const now = new Date();
    for (const ref of app.decks) {
      try {
        const data = ref.key === active && app.data ? app.data : await openDeck(ref).load();
        const s = deckSummary(data, now);
        info[ref.key] = { due: s.due, fresh: s.batch?.cards.length ?? 0 };
      } catch { /* a deck that fails to load still shows, so it can be removed */ }
    }
  });

  async function run(label: string, task: () => Promise<void>) {
    busy = label; message = ''; progress = '';
    try { await task(); } catch (e) { message = (e as Error).message; }
    busy = '';
  }

  async function choose(ref: DeckRef) {
    setActiveDeck(ref.key);
    await reload();
    location.hash = '#/';
  }

  /** Where others can fetch this deck from: its own GitHub folder, or where it was imported from. */
  function linkOf(ref: DeckRef): string {
    if (ref.store === 'github' && app.repo) return `github:${app.repo.owner}/${app.repo.repo}${ref.root ? `/${ref.root.replace(/\/$/, '')}` : ''}@${app.repo.branch}`;
    return ref.source;
  }

  const share = (ref: DeckRef) => run('Собираю файл…', async () => {
    const file = await exportDeck(ref, onProgress);
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: ref.name }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    message = `Файл ${file.name} сохранён (${(file.size / 1e6).toFixed(1)} МБ).`;
  });

  async function copyLink(ref: DeckRef) {
    const url = shareLink(linkOf(ref));
    try { await navigator.clipboard.writeText(url); message = ref.store === 'github' ? 'Ссылка скопирована. Она откроется у тех, у кого есть доступ к репозиторию: для всех — сделайте его публичным.' : 'Ссылка скопирована.'; }
    catch { message = url; }
  }

  const fromSource = (ref: DeckRef) => run('Проверяю обновления…', async () => {
    const check = await checkUpdate(ref, undefined, onProgress);
    update = { key: ref.key, check };
    if (!check.plan.write.length && !check.plan.remove.length) { update = null; message = 'Обновлений нет: колода совпадает с источником.'; }
  });

  function pickFile(ref: DeckRef) { fileFor = ref; fileInput?.click(); }
  const fromFile = (file: File) => run('Читаю файл…', async () => {
    const ref = fileFor!;
    const check = await checkUpdate(ref, await readPackageFile(file), onProgress);
    update = { key: ref.key, check };
  });

  const apply = (ref: DeckRef) => run('Обновляю…', async () => {
    await applyUpdate(ref, update!.check.plan, onProgress);
    update = null;
    message = 'Колода обновлена, прогресс сохранён.';
  });

  const remove = (ref: DeckRef) => {
    const where = ref.store === 'github' ? `Папка ${ref.root} будет удалена из репозитория коммитом.` : 'Колода и её прогресс будут удалены с этого устройства.';
    if (!confirm(`Удалить «${ref.name}»? ${where}`)) return;
    run('Удаляю…', () => removeDeck(ref));
  };
</script>

<div class="wrap">
  <h1 class="display page">Колоды</h1>
  <p class="muted lead">Учите одну колоду за раз; у каждой своё расписание и прогресс.</p>

  <input bind:this={fileInput} class="hidden" type="file" accept="{PACKAGE_EXT},.zip,application/zip" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) fromFile(f); (e.currentTarget as HTMLInputElement).value = ''; }} />

  <ul class="decks">
    {#each app.decks as ref (ref.key)}
      {@const i = info[ref.key]}
      <li class="deck" class:on={ref.key === active}>
        <button class="main" type="button" onclick={() => (ref.key === active ? (open = open === ref.key ? '' : ref.key) : choose(ref))}>
          <span class="lang mono"><b>{ref.lang.split(' → ')[0]}</b><small>→ {ref.lang.split(' → ')[1]}</small></span>
          <span class="txt">
            <b>{ref.name}</b>
            <span class="muted">{ref.cards} {plural(ref.cards, 'карточка', 'карточки', 'карточек')} · {STORE_NAME[ref.store]}{i ? ` · ${i.due ? `${i.due} к повторению` : i.fresh ? `${i.fresh} новых` : 'всё повторено'}` : ''}</span>
          </span>
          {#if ref.key === active}<span class="cur">сейчас</span>{/if}
        </button>
        <button class="more" type="button" aria-label="Действия" aria-expanded={open === ref.key} onclick={() => (open = open === ref.key ? '' : ref.key)}>
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
        {#if open === ref.key}
          <div class="actions">
            {#if ref.description}<p class="muted desc">{ref.description}</p>{/if}
            {#if ref.key !== active}<button class="btn small" type="button" onclick={() => choose(ref)}>Учить эту</button>{/if}
            {#if ref.key === active && app.data?.placement?.length}<a class="btn small ghost" href="#/placement">{app.data.known ? `Тест словаря заново · знаю ${app.data.known.words.length}` : 'Тест словаря'}</a>{/if}
            <button class="btn small ghost" type="button" disabled={!!busy} onclick={() => share(ref)}>Поделиться файлом</button>
            {#if linkOf(ref)}<button class="btn small ghost" type="button" onclick={() => copyLink(ref)}>Скопировать ссылку</button>{/if}
            {#if ref.source}<button class="btn small ghost" type="button" disabled={!!busy} onclick={() => fromSource(ref)}>Обновить из источника</button>{/if}
            <button class="btn small ghost" type="button" disabled={!!busy} onclick={() => pickFile(ref)}>Обновить из файла</button>
            {#if ref.root}<button class="btn small ghost danger" type="button" disabled={!!busy} onclick={() => remove(ref)}>Удалить</button>{/if}
            {#if ref.source}<p class="muted src mono">{ref.source}</p>{/if}
          </div>
        {/if}
        {#if update?.key === ref.key}
          {@const p = update.check.plan}
          <div class="update">
            <b>Есть обновление</b>
            <span class="muted">Новых файлов: {p.added} · изменено: {p.changed} · удалено автором: {p.remove.length}{p.kept ? ` · сохранено из-за прогресса: ${p.kept}` : ''}</span>
            <div class="row">
              <button class="btn small" type="button" disabled={!!busy} onclick={() => apply(ref)}>Обновить</button>
              <button class="btn small ghost" type="button" onclick={() => (update = null)}>Не сейчас</button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <a class="btn block amber" href="#/add">Добавить колоду</a>
  {#if busy}<p class="status muted" role="status">{busy} {progress}</p>{/if}
  {#if message}<p class="status" role="status">{message}</p>{/if}
</div>

<style>
  .page { margin-top: 8px; }
  .lead { margin: 0 4px 14px; font-size: 15px; }
  .hidden { display: none; }
  .decks { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 10px; }
  .deck { background: var(--card); border: 1px solid var(--line); border-radius: 16px; display: grid; grid-template-columns: 1fr auto; overflow: hidden; }
  .deck.on { border-color: var(--rule-strong); }
  .main { display: flex; align-items: center; gap: 12px; padding: 14px 4px 14px 14px; border: 0; background: none; text-align: left; cursor: pointer; color: var(--ink); min-width: 0; }
  .lang { flex: none; width: 52px; height: 52px; border-radius: 12px; background: var(--brand); color: var(--on-brand); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
  .lang b { font: 600 17px/1 var(--font-mono); }
  .lang small { font-size: 10px; }
  .txt { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .txt b { font: 600 17px/1.2 var(--font-display); }
  .txt .muted { font-size: 13px; }
  .cur { flex: none; font: 400 12px/1 var(--font-mono); color: var(--amber-ink); background: var(--amber-soft); padding: 5px 8px; border-radius: 6px; }
  .more { width: 48px; border: 0; background: none; cursor: pointer; color: var(--ink-2); }
  .more svg { width: 22px; height: 22px; fill: currentColor; }
  .actions, .update { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; padding: 0 14px 14px; animation: zb-rise 200ms var(--ease-out) both; }
  .desc, .src { flex-basis: 100%; margin: 0; font-size: 13px; }
  .src { word-break: break-all; }
  .danger { color: var(--again); }
  .update { flex-direction: column; background: var(--amber-soft); margin: 0 10px 10px; padding: 12px; border-radius: 12px; }
  .update .muted { font-size: 13px; }
  .row { display: flex; gap: 8px; }
  .status { margin: 12px 4px; font-size: 14px; }
</style>
