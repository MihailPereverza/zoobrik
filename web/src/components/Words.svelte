<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { plural } from '../lib/activity';
  import { STAGE_LABEL, stageOf } from '../lib/summary';
  import { allTags, countsByStatus, filterCards, filterToQuery, KIND_LABEL, queryToFilter, sortCards, STATUS_LABEL, type WordKind, type WordStatus } from '../lib/words';
  import { isIntroduced } from '../lib/scheduler';
  import { cardCoverage, cardLocked } from '../lib/lexicon';

  let { query = '' }: { query?: string } = $props();
  const initial = queryToFilter(untrack(() => query));
  let q = $state(initial.q);
  let status = $state<WordStatus>(initial.status);
  let kind = $state<WordKind>(initial.kind);
  let tag = $state(initial.tag);
  let limit = $state(60);

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const filter = $derived({ q, status, kind, tag });
  const found = $derived(sortCards(filterCards(data, filter, now), q));
  const shown = $derived(found.slice(0, limit));
  const counts = $derived(countsByStatus(data, now));
  const tags = $derived(allTags(data));
  const practicable = $derived(found.filter(isIntroduced).length);
  const statuses = $derived((Object.keys(STATUS_LABEL) as WordStatus[]).filter((s) => s === 'all' || counts[s] > 0 || s === status));

  // Keep the filter in the address so Back from a card returns to the same list.
  $effect(() => {
    const qs = filterToQuery(filter);
    const target = `#/words${qs ? `?${qs}` : ''}`;
    if (location.hash !== target) history.replaceState(null, '', target);
  });
  $effect(() => { void filter; limit = 60; });
</script>

<div class="wrap">
  <h1 class="display page">Слова</h1>
  <p class="muted lead">{data.deck.name} · {counts.all} {plural(counts.all, 'карточка', 'карточки', 'карточек')}</p>

  <label class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
    <input type="search" bind:value={q} placeholder="Слово, перевод или пример" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Поиск" />
  </label>

  <div class="chips" role="radiogroup" aria-label="Статус">
    {#each statuses as s (s)}
      <button type="button" role="radio" aria-checked={status === s} class="f" class:on={status === s} onclick={() => (status = s)}>{STATUS_LABEL[s]} <span class="num">{counts[s]}</span></button>
    {/each}
  </div>
  <div class="chips" role="radiogroup" aria-label="Вид">
    {#each Object.keys(KIND_LABEL) as k (k)}
      <button type="button" role="radio" aria-checked={kind === k} class="f small" class:on={kind === k} onclick={() => (kind = k as WordKind)}>{KIND_LABEL[k as WordKind]}</button>
    {/each}
    {#each tags as t (t)}
      <button type="button" class="f small tag" class:on={tag === t} aria-pressed={tag === t} onclick={() => (tag = tag === t ? '' : t)}>#{t}</button>
    {/each}
  </div>

  {#if practicable}
    <a class="btn block practice" href="#/session/practice?{filterToQuery(filter)}">Потренировать {practicable === found.length ? 'эти' : 'начатые'} {practicable} {plural(practicable, 'карточку', 'карточки', 'карточек')}</a>
  {/if}

  {#if found.length}
    <ul class="list">
      {#each shown as card (card.path)}
        {@const stage = stageOf(card)}
        <li>
          <a href="#/card/{card.topic}/{card.id}">
            <span class="txt"><b>{card.content.term ?? card.content.title}</b><span class="muted">{card.content.meaning ?? card.content.formula ?? ''}</span></span>
            {#if card.listening && !isIntroduced(card)}<span class="st cov" class:locked={cardLocked(data, card)} title="Знакомых слов в клипе">{data.known ? `${Math.round(cardCoverage(data, card) * 100)}%` : 'тест'}</span>{/if}
            {#if card.progress?.leech}<span class="st hard">трудное</span>{/if}
            <span class="st {stage}">{STAGE_LABEL[stage]}</span>
          </a>
        </li>
      {/each}
    </ul>
    {#if found.length > shown.length}<button class="btn ghost block" type="button" onclick={() => (limit += 120)}>Показать ещё {found.length - shown.length}</button>{/if}
  {:else}
    <p class="empty muted">Ничего не нашлось{q ? ` по «${q}»` : ''}.</p>
  {/if}
</div>

<style>
  .page { margin-top: 8px; }
  .lead { margin: 0 4px 12px; font-size: 15px; }
  .search { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
  .search:focus-within { border-color: var(--ink); }
  .search svg { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--ink-3); stroke-width: 2; stroke-linecap: round; }
  .search input { flex: 1; min-width: 0; border: 0; background: none; font: 400 16px/1 var(--font-body); color: var(--ink); outline: none; }
  .chips { display: flex; gap: 6px; overflow-x: auto; margin: 10px -16px 0; padding: 0 16px 2px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .f { flex: none; height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); font: 500 14px/1 var(--font-body); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background-color 200ms var(--ease), color 200ms var(--ease); }
  .f.small { height: 32px; font-size: 13px; }
  .f .num { font: 400 12px/1 var(--font-mono); color: var(--ink-3); }
  .f.on { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
  .f.on .num { color: var(--on-brand); }
  .f.tag { font-family: var(--font-mono); }
  .practice { margin-top: 14px; }
  .list { list-style: none; margin: 14px 0 12px; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
  .list li + li { border-top: 1px solid var(--line); }
  .list a { display: flex; align-items: center; gap: 10px; padding: 12px 16px; min-height: 56px; text-decoration: none; color: var(--ink); }
  .list a:active { background: var(--soft); }
  .txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .txt b { font-weight: 600; font-size: 16px; }
  .txt .muted { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st { flex: none; height: 24px; padding: 0 8px; border-radius: 6px; font: 400 12px/24px var(--font-mono); background: var(--soft); color: var(--ink-2); }
  .st.learning { background: var(--amber-soft); color: var(--amber-ink); }
  .st.review, .st.mastered { background: var(--good-bg); color: var(--good); }
  .st.cov { background: none; border: 1px solid var(--line); line-height: 22px; }
  .st.cov.locked { color: var(--ink-3); }
  .st.hard { background: var(--again-bg); color: var(--again); }
  .empty { text-align: center; padding: 40px 0; }
</style>
