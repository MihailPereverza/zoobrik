# Writing exercises for a listening card

A listening card is a folder `topics/listening/<id>/` with `clip.mp4` or `clip.mp3`, `transcript.yaml` (timed lines, speakers),
`seg<N>.mp3` (audio of transcript line N, only for lines between 1.2 and 12 s) and `card.yaml`. The app shows the player and a
transcript the learner can open on demand (opening it counts as a hint) above every exercise of the card. The learner is a
Russian speaker at A2 working through the deck's rules in order (see `deck.yaml`): questions with *to be*, Present Simple,
wh-questions, adjective order, adverbs of frequency, Present Continuous, Past Simple, comparatives, Present Simple vs
Continuous. Vocabulary: appearance, character, clothes, prepositions of place. A clip opens only when 95% of its words are
known **and** the rules in its `needs:` are learned (see «Grammar and level» below).

## Principles

- Every exercise must be answerable **from the clip** (or from general knowledge the clip relies on). Never test words or
  facts that are not in the clip. If a phrase is idiomatic, explain it in the back side (`???`).
- Instructions in **Russian**, questions and options in **simple English** (A2–B1). Explanations after `???` in Russian,
  quoting the line from the clip that proves the answer (with the speaker).
- Distractors must be plausible: things that are said in the clip but about someone else, the opposite of what was said,
  a detail from another moment, a near-synonym that changes meaning. No joke options.
- Go from easy to hard with `difficulty: 1…5`. Gist questions 1–2, details 2–3, true/false/not said 3, exact phrase 3–4,
  dictation 4, order 3–4, grammar in context 4–5, AI tasks 4–5.
- Never put the answer word in the question.
- True / False / Not said: **False** only when the clip states the opposite. If the clip simply does not mention it, the
  answer is **Not said** («A tailor makes men's clothing» does not make «a tailor makes women's clothing» false).
- The answer must be backed by a line of the clip. Do not add what the scene only suggests («Anna is late for work» when
  nobody says she is late).

## Files to write

Exercises go to two places:

1. `exercises/*.md` — markdown exercises, one file each, frontmatter `id`, `skill`, `status: ready`, `difficulty`, and
   when needed `needs: [card-id]`, `allow: [word]`, `allow_rules: [rule-id]` (same meaning as in card.yaml exercises).
2. `card.yaml` → `exercises:` — YAML exercises (dictation and AI tasks). Keep `id`, `kind`, `tags`, `content` untouched; only
   replace the `exercises:` list. Ids: `md1…`, `d1…`, `ai1…`, unique in the card.

### Markdown formats (exercises/*.md)

Multiple choice (exactly one `[x]`):

```md
---
id: md1
skill: listen
status: ready
difficulty: 2
---
**Где Анна обедает, когда она на работе?**

- [ ] In her office.
- [x] Outside.
- [ ] In a café with her boss.

???

Anna: «When I'm at work, I love eating lunch **outside**.»
```

True / False / Not said — same format, options exactly `True`, `False`, `Not said`, the statement in bold.

What exactly did they say — options are four near-identical sentences, one is the exact line (tests hearing small words:
*is wearing / wears / was wearing*).

Gaps in a transcript excerpt (2–4 gaps, each gap one to three words that are clearly audible; `|` separates accepted variants):

```md
Anna: «Ashley, you have [[straight]] hair. Keyana and I have [[curly]] hair.»
```

Put events in order (4–5 short phrases, written in the right order; the app shuffles them):

```md
Расставь события в том порядке, в котором они происходят.

[[order: Anna eats lunch outside · Keyana joins them · Ashley leaves · The boss finds Anna]]
```

Complete the dialogue — show 1–2 lines, ask which reply comes next, options are four replies (one from the clip).

Grammar in context — quote a line and ask why that form is used (*Why "is eating" and not "eats"?*), or which form the
speaker used. Explanations must name the rule (now / around now / temporary / arrangement / state verb / always+ing), and
the exercise gets `needs:` for that rule (table below).

### YAML exercises (card.yaml)

Dictation of one line (use only `seg<N>.mp3` files that exist; N is the line number `n` in transcript.yaml):

```yaml
- id: d1
  template: listen-type
  skill: [listen, spell]
  status: ready
  difficulty: 4
  params:
    audio: seg12.mp3
    answer: "Does she wear glasses?"
    accept: ["Does she wear glasses"]
    translation: "Она носит очки?"
```

Free answer checked by AI (`open-answer`): an open question about the clip, a retelling, or a role-play reply.

```yaml
- id: ai1
  template: open-answer
  skill: context
  status: ready
  difficulty: 4
  params:
    question: "**Опиши начальницу Анны** по-английски (2–3 предложения): как она выглядит и во что одета сегодня."
    model_answer: "She is short and has straight, light hair. She wears glasses and today she is wearing a blue sweater."
    criteria: "short; straight light hair; glasses; blue sweater today; uses Present Continuous for today's clothes"
```

Role-play: «Ты — Ashley. Anna asks: "Are you returning to work?" Ответь как Эшли и объясни почему (1–2 предложения).»

## How many

Per clip: 10–14 exercises:

- 2 gist questions;
- 3 detail questions;
- 2 True/False/Not said;
- 1 exact phrase;
- 1 order;
- 1 gaps;
- 2 dictations;
- 1 grammar or vocabulary in context;
- 1 complete-the-dialogue (for dialogues);
- 2 AI tasks.

Short clips (< 40 s) may have 6–8. Films and TV with strong accents: more gist and fewer dictations. A clip may have fewer
than 2 dictations (or none) when no `seg<N>.mp3` line of 1.2–12 s uses only taught grammar — say so in the card's review
notes rather than dictating a line with untaught grammar.

## Grammar and level

The learner never meets a construction before its rule card is learned (Rule G, see `docs/deck-format.md` →
«Prerequisites»). A clip cannot be rewritten, so the gate is on the card:

- **Every clip gets card-level `needs:`** at the top of card.yaml — the rule cards the clip *and* its English question
  stems rely on. The card is not introduced until those cards are **learned**. English wh-questions about the clip
  (*What does Anna want?*) mean at least `questions-wh`; a clip built on Present Continuous needs `pc-now` (and `pc-future`
  for plans); a past narrative needs `past-regular`, `past-irregular`, `past-did-questions`; vocabulary the clip is about
  (prepositions) can be gated too: `prepositions-place/on`.

  ```yaml
  id: lle-07-what-are-you-doing
  kind: listening
  needs: [questions-wh, pc-now]
  ```

- **Exercises whose construction a rule card detects wait by themselves** (the rule's `detect:` patterns). Use exercise
  `needs:` for what a pattern cannot see — reasoning about a contrast. Map the explanation to the card:

  | the exercise asks why… | `needs:` |
  |---|---|
  | now | `pc-now` |
  | around now | `pc-around-now` |
  | temporary vs permanent | `ps-pc-permanent-temporary` |
  | habit vs now | `ps-pc-habit-now` |
  | always / usually vs today | `ps-pc-signal-words` |
  | arrangement, plan | `pc-future` / `ps-pc-future` |
  | state verb | `pc-stative` / `ps-pc-state-action` |
  | *have* as an action | `pc-dual-verbs` |
  | clothes in general vs today | `ps-pc-clothes` |
  | *Does she…? / Is she …ing?* | `ps-pc-questions` |
  | past | `past-to-be`, `past-regular`, `past-irregular`, `past-did-questions` |

- **Never test grammar the deck does not teach** — in gaps, exact-phrase options that differ only in that form,
  dictations, grammar questions or AI criteria: present perfect, past continuous, passive, *would / could / should / must /
  might*, *have (got) to*, *had better / would rather*, tag questions, gerund after a preposition (*good at asking*),
  *the -er…, the more…*, conditionals. Such forms may stay in a quoted line; then test something else in it (put the gap
  on a noun, ask about the meaning) and gloss the form in the explanation («*have to* — приходится»). Distractors use
  taught grammar too (not *I was bothering…*).
- **Dictation lines** use only taught grammar. **Past narratives** (fables) are retold in exercises in the narrative
  present: *The Fox sees the grapes · The Fox jumps*, not *saw / jumped*.
- **`level`** is the real level of the text: VOA Let's Learn English A2, Ask a Teacher / Everyday Grammar B1, Aesop
  (19th-century English), films, old TV, NASA narration — B2. B1 and B2 clips are gated behind all rules (the last rule of
  every grammar topic in `needs:`), since they use grammar the deck never teaches.

## Transcript hygiene

- **Only what is heard.** Words whose timing has zero length (`[word, 88.74, 88.74]`) in a run at the start or end of a
  line are script text outside the clip: delete those words from `words` and from `text` (mark the cut with `…`), and fix
  `start`/`end`. A whole line of them goes. Single zero-length words inside a line (names, numbers, *D.C.*) are usually
  heard — the aligner just could not time them; keep them.
- **Stage directions are not speech:** no «(Spills papers)», «(In the garage)» in `text`. A line that is only a stage
  direction is deleted.
- **`speaker`** is filled for every line of a dialogue; «1:» / «2:» labels go into `speaker`, not `text`.
- **`n` is unique** (it names `seg<N>.mp3`). Deleting a line leaves a gap in `n` — fine; never renumber lines that have
  segment files.
- Check for long stretches of the clip with no lines (speech the aligner missed) and for mis-hearings (*a hedge, Apple* →
  *a hedge apple*).
- Exercises use only `seg<N>.mp3` whose line is fully audible; after trimming a line, do not dictate it.
