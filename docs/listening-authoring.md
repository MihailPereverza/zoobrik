# Writing exercises for a listening card

A listening card is a folder `topics/listening/<id>/` with `clip.mp4` or `clip.mp3`, `transcript.yaml` (timed lines, speakers),
`seg<N>.mp3` (audio of transcript line N, only for lines between 1.2 and 12 s) and `card.yaml`. The app shows the player and a
transcript the learner can open on demand (opening it counts as a hint) above every exercise of the card. The learner is a
Russian speaker at A2–B1 who is studying Present Simple vs Continuous, clothes, appearance and prepositions of place.

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

## Files to write

Exercises go to two places:

1. `exercises/*.md` — markdown exercises, one file each, frontmatter `id`, `skill`, `status: ready`, `difficulty`.
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
speaker used. Explanations must name the rule (now / around now / temporary / arrangement / state verb / always+ing).

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

Short clips (< 40 s) may have 6–8. Films and TV with strong accents: more gist and fewer dictations.
