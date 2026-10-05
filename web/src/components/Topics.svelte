<script lang="ts">
  import TopicCard from './TopicCard.svelte';
  import { app } from '../lib/state.svelte';
  import { topicSummary } from '../lib/summary';

  const now = $derived.by(() => { void app.version; return new Date(); });
  const data = $derived(app.data!);
  const topics = $derived(data.topics.map((t) => topicSummary(data, t, now)));
  const titleOf = (id: string) => data.topics.find((x) => x.id === id)?.title ?? id;
  const groups = $derived([
    { title: 'Слова', list: topics.filter((t) => t.topic.kind !== 'grammar') },
    { title: 'Грамматика', list: topics.filter((t) => t.topic.kind === 'grammar') },
  ]);
</script>

<div class="wrap">
  <h1 class="display page">{data.deck.name}</h1>
  {#if data.deck.description}<p class="muted lead">{data.deck.description}</p>{/if}
  {#each groups as g (g.title)}
    {#if g.list.length}
      <h2 class="section">{g.title}</h2>
      <div class="list">{#each g.list as t, i (t.topic.id)}<TopicCard {t} delay={i * 40} {titleOf} />{/each}</div>
    {/if}
  {/each}
</div>

<style>
  .page { margin-top: 8px; }
  .lead { margin: 0 4px 4px; font-size: 15px; }
  .list { display: grid; gap: 10px; }
</style>
