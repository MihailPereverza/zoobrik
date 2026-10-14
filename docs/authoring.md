# Как добавлять свои правила, задания и типы заданий

Руководство автора колоды. Всё здесь сверено с кодом приложения (`web/src/lib`), пример своего типа задания проверен
в браузере. Формат файлов подробно описан в [`deck-format.md`](deck-format.md); `spec.html` — замысел, часть которого
ещё не реализована (там она помечена «не реализовано»).

Два пути:

- **А. Новое правило или новые задания на готовых шаблонах.** Хватает почти всегда: выбор варианта, вписать слово,
  исправить ошибку, собрать фразу из фишек, задания в Markdown. Нужны только YAML и Markdown.
- **Б. Свой тип задания.** Когда нужна новая механика: своя вёрстка (`view.njk`), стили (`style.css`), поведение
  (`logic.js`) и своя проверка ответа (`export function check`).

---

## 0. Цикл проверки: всегда на копии колоды

Сервер разработки пишет прогресс и журнал прямо в файлы колоды (`card.yaml → progress`, `journal/`). Поэтому
экспериментируйте на копии:

```sh
cp -R decks/english-notebook /tmp/deck-try          # или git worktree колоды
cd web
ZOOBRIK_DECK=/tmp/deck-try npm run dev:test         # http://localhost:5173
```

`dev:test` отключает git-синхронизацию (`ZB_NO_SYNC=1`). Простой `npm run dev` по кнопке «Синхронизировать» и в конце
сессии делает commit и push в колоду — для экспериментов не годится.

Что смотреть:

1. **Карточка** (Слова → карточка): справа список заданий и живое превью. «Заново» перерисовывает задание,
   под превью строка «Верно / Неверно · правильно: … → оценка N» — так видно, что засчитывает проверка.
   «Параметры» правит `params` прямо в YAML, кнопки `ready / draft / off` меняют статус.
2. **«Профиль → Проверить колоду»**: рендерит каждое задание, решает его эталонным ответом (`choice`, `tokens`,
   `fuzzy`, `exact`, `md`), находит неизвестные типы проверки, `custom` без `export function check`, нет `[x]` в
   Markdown-выборе, отсутствующие аудио, незнакомые слова и грамматику раньше правила.
3. **Командная строка** (из корня репозитория):

   ```sh
   tools/.venv/bin/python tools/validate_deck.py /tmp/deck-try        # формат, шаблоны, параметры, навыки
   cd web && npm run lexicon -- /tmp/deck-try --assume-top 1387         # слова (Rule B) и грамматика (Rule G)
   ```

   `validate_deck.py` знает шаблоны всех уровней (core, `templates/` колоды, `views/` темы и карточки), проверяет
   обязательные параметры из манифеста, навыки и типы проверки; предупреждает (`warning:`), если навык задания не
   стоит на лестнице колоды — такое задание никогда не спросят.
4. **Сессия**: «Начать» на главной. Новая карточка придёт в порции новых слов (правило — одно на порцию).

Когда всё готово — перенесите файлы в настоящую колоду (или закоммитьте worktree).

---

## Путь А. Новое правило на готовых шаблонах

### А1. Где правило живёт

```
decks/<deck>/
  deck.yaml                      # topics: порядок тем
  topics/grammar-articles/       # тема правил
    topic.yaml
    a-an/                        # карточка = одно правило (один случай)
      card.yaml
      theory.md
      exercises/*.md             # задания в Markdown, подхватываются сами
      ex1.mp3, ex2.mp3           # озвучка примеров (tools/voice.py)
```

**deck.yaml** — тема должна стоять в списке `topics:` (порядок тем; темы вне списка идут после, по алфавиту):

```yaml
topics:
  - basics
  - grammar-articles      # правила вводятся по одному вместе с порциями слов
```

**topic.yaml**:

```yaml
id: grammar-articles          # = имя папки
title: Артикли a / an
description: a перед согласным звуком, an перед гласным.
kind: grammar                 # именно это делает тему темой правил
level: A1
requires: [basics]            # тема откроется, когда из basics начата порция слов
batch: 1
order: [a-an]                 # все карточки темы ровно по разу, в порядке ввода
```

Как правило попадает в занятия: каждая порция новых слов приносит одно правило из первой открытой grammar-темы
(в порядке `deck.yaml`), лимит `limits.new_rules_per_day` (по умолчанию 2). Grammar-тема открывается, когда у
словарных тем из `requires` начата порция, а grammar-темы из `requires` выучены целиком. Внутри темы следующее
правило ждёт, пока выучены предыдущие.

### А2. Карточка правила

Одна карточка — одно правило или один случай. Лучше много маленьких карточек, чем одна большая.

```yaml
id: a-an                       # = имя папки, уникален в колоде
kind: grammar
detect:                        # Rule G, см. А5: как найти эту конструкцию в предложении
  - "\\ban\\s+[a-z]"
content:
  title: 'a или an'            # заголовок (вместо слова)
  formula: a + согласный звук · an + гласный звук
  theory: theory.md            # Markdown, показывается целиком на экране знакомства
  examples:                    # 2+ примера, у каждого озвучка <id>.mp3
    - id: ex1
      en: I have an apple.
      ru: У меня есть яблоко.
      audio: ex1.mp3
    - id: ex2
      en: She is a teacher.
      ru: Она учитель.
      audio: ex2.mp3
exercises: [...]
```

`theory.md` — по-русски, коротко: правило, таблица, «Ловушки». Ученик видит его на экране знакомства (шаблон `intro`)
и в оборотах карточки («Правило целиком»).

### А3. Задания

У правила 15–25 заданий от простых к сложным (`difficulty: 1…5`; 4–5 — ловушки). Порядок важен только при
изучении: пока карточка учится, задания идут от лёгких к трудным, в повторениях — вперемешку.

```yaml
exercises:
  - id: e1
    template: intro            # экран знакомства: формула, примеры, теория
    status: ready
    params: {}
  - id: e2
    template: cloze-choice
    skill: apply               # навык; для правил — apply
    status: ready              # draft | ready | off; спрашиваются только ready
    difficulty: 1
    params:
      text: I have ___ apple.
      answer: an
      options: [a, an]
      translation: У меня есть яблоко.
      explanation: apple начинается с гласного звука → **an**.
  - id: e3
    template: grammar-fix
    skill: apply
    status: ready
    difficulty: 3
    params:
      wrong: She is an teacher.
      answer: She is a teacher.
      accept: []
      translation: Она учитель.
  - id: e4
    template: word-order
    skill: apply
    status: ready
    params:
      instruction: Собери предложение.
      tokens: [I, have, an, apple.]
      answer: I have an apple.
      accept: []
```

Задание в Markdown — файл `exercises/md1.md` в папке карточки, подхватывается сам:

```md
---
id: md1
skill: apply
status: ready
difficulty: 2
---
Вставь артикль.

I need [[an]] umbrella. He is [[a]] doctor.

???

umbrella — гласный звук → **an**; doctor → **a**.
```

Разметка Markdown-задания (один вид взаимодействия на задание):

| разметка | что получается | проверка |
|---|---|---|
| `- [x] верно` / `- [ ] неверно` | выбор варианта (ровно один `[x]`) | совпадение |
| `[[goes\|is going]]` | поле в тексте, `\|` — другие верные ответы | как `fuzzy` (опечатки → Hard) |
| `[[chips: She · goes · to · work. \| go · going]]` | сборка из фишек: ответ, затем лишние | порядок слов |
| `[[order: a · b · c]]` | расставить по порядку (записан правильный) | точный порядок |
| `!audio(ex1.mp3)` | кнопка аудио | — |
| `???` | дальше — оборот (пояснение после ответа) | — |
| ничего из этого | карточка-переворот, ученик оценивает себя 1–4 | самооценка |

### А4. Справочник готовых шаблонов

| шаблон | навык | params | проверка |
|---|---|---|---|
| `intro` | — | `{}` | нет (экран знакомства) |
| `cloze-choice` | context / apply | `text` (пропуск `___`), `answer`, `options[2–4]`, `instruction?`, `translation?`, `audio?` | `choice` |
| `cloze-type` | context / apply | `text`, `answer`, `accept[]`, `hint?`, `translation?`, `audio?` | `fuzzy` |
| `grammar-fix` | apply | `wrong`, `answer`, `accept[]`, `translation?`, `audio?` | `fuzzy` |
| `word-order` | apply / context | `instruction`, `tokens[]` (ровно слова ответа), `answer`, `accept[]`, `translation?`, `audio?` | `tokens` |
| `build-term` / `build-meaning` | context | `prompt`, `answer`, `accept[]`, `extra[2–4]`, `audio?` | `tokens` |
| `meaning-choice`, `term-choice`, `listen-choice` | recognize / recall / listen | `answer`, `options[]`, … | `choice` |
| `term-type`, `listen-type` | recall / listen | `answer`, `accept[]`, … | `fuzzy` |
| `meaning-flip` | recognize | `front`, `back`, `note?`, `audio?` | самооценка |
| `match-pairs` | recognize | `pairs: [[en, ru], …]` — только в `exercises.yaml` темы | число ошибок |
| `open-answer` | context | `question`, `model_answer`, `criteria?`, `placeholder?` | ИИ (или самопроверка по образцу) |
| `clip-type` / `clip-choice` | listen | фрагмент фильма: `video`, `text`, `words`, `source` + ответ (см. А6) | `fuzzy` / `choice` |
| `md` | любой | файл `exercises/*.md` | по разметке |

Общие необязательные поля любого задания: `explanation` (Markdown, после ответа), `difficulty`, `from`
(из какого примера сделано). Полный список и правила (`audio` — только `word.mp3` и `<example id>.mp3`) —
в [`deck-format.md`](deck-format.md).

Что ещё можно у одного задания, без своего шаблона:

```yaml
- id: e9
  template: cloze-choice
  skill: apply
  status: ready
  check: { type: choice, expected: an }   # переопределить проверку или ожидаемый ответ
  style: |                                # свои стили только для этого задания
    .zb-cloze { font-size: 26px }
  params: { ... }
- id: e10                                 # разовая вёрстка прямо в записи (без logic.js)
  template: inline
  skill: apply
  status: ready
  check: { type: choice, expected: an hour }
  view: |
    <div class="zb"><p class="zb-prompt">Как правильно?</p>
    {% for o in ["a hour", "an hour"] | shuffle(seed) %}<button class="zb-option" data-zb-choice="{{ o }}">{{ o }}</button>{% endfor %}</div>
  params: {}
```

### А5. Предпосылки: ученик не встречает то, чему его не учили

| что | как находится | что происходит |
|---|---|---|
| слова (Rule B) | тест на знание слов (`known.yaml`) + слова введённых карточек | задание с незнакомым словом ждёт карточку с этим словом |
| грамматика (Rule G) | `detect:` карточек-правил | задание с конструкцией ждёт, пока её правило **выучено** |
| что угодно | `needs: [card-id]` у задания | ждёт, пока эти карточки введены |
| вся карточка | `needs: [card-id]` в начале card.yaml | не вводится, пока эти карточки не выучены |

`detect` — регулярные выражения JavaScript без учёта регистра; проверяются на каждом предложении задания с пропусками,
заполненными ответом (текст, варианты, фишки). Ложное срабатывание лишь задерживает задание, пропуск пускает
конструкцию раньше правила — пишите точно. Поля задания:

```yaml
needs: [present-simple-he-she]   # ждать эти карточки (id или topic/id)
allow: [Anna]                    # слова, которые никогда не блокируют задание (имена)
allow_rules: [pc-form]           # правила, чей detect сработал по ошибке
```

Примеры карточки ждать не могут (их показывает экран знакомства): в примерах — только правила, введённые раньше.
`npm run lexicon -- <deck> --assume-top 1387` печатает порядок ввода и обе проверки: «card examples shown before their
rule» должно быть 0; «exercises waiting for a later rule» — нормально, если у карточки остаётся достаточно заданий.

### А6. Фрагменты фильмов (playphrase.me)

Задания `clip-type` (вписать пропуск или написать всю реплику) и `clip-choice` (выбрать, что сказал герой) показывают
короткую сцену из фильма. **В колоде только ссылки**: адрес видео на playphrase.me, реплика с таймингом слов и название
фильма со ссылкой на IMDb. Видео приложение берёт с playphrase.me в момент показа; скачивать клипы в колоду или в
репозиторий нельзя. Без сети задание показывает «Видео недоступно» и «Пропустить».

```sh
tools/.venv/bin/python tools/playphrase.py <колода> --cards wear,cmp-er --per-card 2 --dry-run   # найти и выбрать
# вписать перевод и пояснения выбранных клипов в tools/playphrase-clips.yaml (шаблон — tools/.cache/playphrase/todo.yaml)
tools/.venv/bin/python tools/playphrase.py <колода> --cards wear,cmp-er --per-card 2             # дописать v1, v2, …
```

Инструмент берёт только реплики, все слова и правила которых ученик знает к шагу карточки (Rule B и G), и дописывает
задания в конец `exercises` — существующие задания и `progress` не трогает. Перевод, пояснения и неверные варианты
(реплика с другим временем или другим выражением времени, 1–2 слова разницы) пишутся вручную. Параметры и правила — в
[`deck-format.md`](deck-format.md#movie-clips-playphraseme).

---

## Путь Б. Свой тип задания

### Б1. Где лежит шаблон и как он находится

Шаблон — папка, в которой есть `view.njk`; `manifest.yaml`, `style.css`, `logic.js` необязательны.
**id шаблона — имя папки** (поле `id` в манифесте не читается).

| где | кому виден | как сослаться |
|---|---|---|
| `topics/<тема>/<карточка>/views/<id>/` | этой карточке | `template: ./views/<id>` (ищется только здесь) или `template: <id>` |
| `topics/<тема>/views/<id>/` | всем карточкам темы | `template: <id>` |
| `templates/<id>/` в корне колоды | всей колоде | `template: <id>` |
| `core-templates/<id>/` | встроенные | `template: <id>` |

`template: <id>` ищется от частного к общему: карточка → тема → колода → core, первый найденный побеждает.
Поэтому папка `templates/cloze-choice/` в колоде **заменяет** встроенный `cloze-choice` во всей колоде; такой шаблон
получает CSS встроенного шаблона с тем же id, свой `style.css` добавляется сверху. Частичного наследования
(`extends`, блоки) нет — копируйте `view.njk` целиком.

### Б2. manifest.yaml: какие поля работают

```yaml
id: article-pick              # для людей; id = имя папки
name: a или an                # название в превью и сессии
trains: [apply]               # навыки по умолчанию (если у задания нет skill)
difficulty: 3                 # 1–5, порядок при изучении (задание может переопределить)
modes: [learn, review, practice]  # где спрашивать; без поля — везде
check: { type: custom }       # как проверять ответ, см. Б5
reveals: []                   # что задание раскрывает (term, meaning, audio)
asks: []                      # что спрашивает; в повторениях ответ после «раскрытия» считается практикой
autoplay: false               # проиграть первую кнопку аудио при показе
params:                       # схема: validate_deck.py проверяет required; формы редактора нет
  items:  { type: list, of: word, required: true }
  answer: { type: text, required: true }
```

**Главное: навык задания должен стоять на лестнице колоды** (`deck.yaml ladder`, по умолчанию
`[recognize, recall, context, listen, apply]`; `spell` считается как `recall`). Задание без такого навыка никогда не
попадёт в сессию — validate_deck.py предупредит.

### Б3. view.njk: вёрстка

Nunjucks (синтаксис Jinja2), автоэкранирование включено. Доступно:

| имя | что это |
|---|---|
| `params` | параметры задания |
| `card` | карточка: `card.id`, `card.kind`, `card.content.term / meaning / alt / title / formula / note / examples[].term / .meaning / .audio` |
| `theory` | текст theory.md карточки |
| `exercise`, `topic {id, title}`, `mode` | запись задания, тема, режим (`intro / learn / review / practice`) |
| `seed` | число для перемешивания (одно на день и задание) |
| `media(file)` | URL файла карточки (аудио, картинка) |
| `lang` | языки колоды: `lang.target.adverb` → «по-английски» |
| `skills` | старая история навыков карточки |
| фильтры | `\| shuffle(seed)`, `\| tokens`, `\| concat(list)`, `\| md` (Markdown), `\| gap('input' \| 'blank' \| 'fill', answer)`, `\| mask(word)`, `\| letters`, `\| notIn(text)` |
| `zubrik(mood, size)` | маскот (SVG) |

Макросы встроенных шаблонов: `{% import "core/_macros" as m %}`, затем `m.options(list, seed)`, `m.chips(answer, extra, seed)`,
`m.play(src)`, `m.playSlow(src)`, `m.wordCard(word, ipa, src)`, `m.explanation(params)`, `m.cardInfo(card, theory, media)`.
Плеер фрагментов фильмов: `{% import "core/_clip" as clip %}`, затем `clip.player(params)`, `clip.transcript(params)` и
`clip.script()`; в logic.js — `window.__zbClip(zb)`.

Готовые классы оформления (`core-templates/_base.css`): `zb` (сетка задания), `zb-card-q` (карточка вопроса),
`zb-prompt`, `zb-instruction`, `zb-translation`, `zb-option` (кнопка-вариант), `zb-input`, `zb-chip`, `zb-submit`,
`zb-flip`, `zb-back`, `zb-answer`, `zb-note`, `zb-md`. Цвета — токены `--zb-good`, `--zb-bad`, `--zb-good-bg`,
`--zb-bad-bg`, `--zb-ink`, `--zb-ink-2`, `--zb-surface` …; светлая и тёмная темы работают сами.

### Б4. Без JS: декларативные атрибуты

Часто logic.js не нужен — достаточно разметки и встроенной проверки:

```html
<button data-zb-choice="an hour">…</button>   → ответ { choice }, проверка choice; клавиши 1–9
<input data-zb-input>                        → ответ { text } по Enter или кнопке; проверка fuzzy / exact
<div data-zb-slot></div> + <button data-zb-chip="word">  → сборка из фишек, ответ { tokens }; проверка tokens
<button data-zb="submit">Проверить</button>  → отправить ответ (фишки, поля) или событие submit для logic.js
<button data-zb="flip">Показать ответ</button> → перевернуть, ученик оценивает себя 1–4
<button data-zb="play" data-src="{{ media('ex1.mp3') }}"> → аудио
<div data-zb-back hidden>…</div>             → показывается после ответа (пояснение)
```

После проверки приложение само отмечает верный/неверный вариант, поля и строку фишек.

### Б5. logic.js и своя проверка

`logic.js` выполняется в той же изолированной рамке, что и вёрстка (iframe `sandbox="allow-scripts allow-popups"`: нет
хранилища и доступа к приложению, ссылки открываются в новой вкладке). Это обычный скрипт, не модуль: `import` нельзя. Работают формы
`export default function (zb) { … }`, `export default (zb) => { … }`, `export default main`.

Мост `zb`:

| вызов | что делает |
|---|---|
| `zb.params` | параметры задания (JSON) |
| `zb.$(sel)`, `zb.$$(sel)` | поиск в DOM рамки (`$$` возвращает массив) |
| `zb.on(event, fn)` | события: `ready` (после старта logic.js), `submit` (кнопка `data-zb="submit"` или Enter, когда нет фишек и полей), `graded` |
| `zb.answer(value)` | отправить ответ (один раз); после него `zb.answered === true`, элементы с `data-zb-*` и `data-zb-lock` блокируются |
| `zb.flip()` | показать оборот, ученик оценивает себя |
| `zb.hint()` | показать `[data-zb-hint]`; правильный ответ с подсказкой — не выше Hard |
| `zb.play(src, rate)` | проиграть аудио |
| `zb.skip()` | отложить задание в конец сессии |
| `zb.grade(1–4)` | поставить оценку — принимается только после проверки или переворота |
| `zb.log(msg, data)` | в журнал отладки (Профиль → Журнал отладки) |

Событие `graded` приходит с `{ correct, typo, expected, marks }` — отметьте свои элементы сами.

**Своя проверка**: `check: { type: custom }` в манифесте и в logic.js функция

```js
export function check(answer, params) {
  return { score, expected, marks };   // или { correct: true/false, … }
}
```

Она вызывается внутри рамки в момент `zb.answer(value)` с тем же `value` и `zb.params`. Результат:

| поле | смысл |
|---|---|
| `correct` | верно ли (если нет — `score >= 0.5`) |
| `score` 0…1 | 1 → Good, от 0.5 → Hard, меньше → Again (если нет — из `correct`) |
| `expected` | что показать как правильный ответ (иначе `params.answer`) |
| `typo` | засчитать с опечаткой (Hard) |
| `marks` | любые данные для отметки элементов — вернутся в событии `graded` |

Если `check()` бросает исключение или ничего не возвращает, ответ не засчитывается, а «Проверить колоду»
и журнал покажут ошибку. Неизвестный тип проверки тоже ошибка (раньше такие ответы молча считались верными).

Дальше оценка идёт как у всех: подсказка или очень долгий ответ снижают её до Hard, ученик может выбрать другую,
затем карточка шагает по лестнице форматов (Good — ступень вверх, Easy — две, Hard — на месте, Again — вниз),
после верхней ступени — интервалы FSRS.

### Б6. Пример: «a или an» (проверен)

Ученик нажимает на слова, переключая артикль, и жмёт «Проверить». Все верно — Good, 3 из 4 — Hard, меньше
половины — Again; строки подсвечиваются зелёным и красным.

`topics/grammar-articles/a-an/views/article-pick/manifest.yaml`

```yaml
id: article-pick
name: a или an
trains: [apply]
difficulty: 3
modes: [learn, review, practice]
check: { type: custom }      # logic.js: export function check(answer, params)
params:
  items:  { type: list, of: word, label: Слова, required: true }
  answer: { type: text, label: Ответ «an apple · a cat», required: true }
  explanation: { type: markdown, label: Пояснение }
```

`view.njk`

```njk
{% import "core/_macros" as m %}
<div class="zb">
  <div class="zb-card-q"><span class="zb-instruction">Нажимай на слово, чтобы выбрать a или an</span></div>
  <div class="ap-list">
    {% for w in params.items %}<button class="zb-option ap-item" type="button" data-zb-lock data-i="{{ loop.index0 }}"><b class="ap-art">a</b><span>{{ w }}</span></button>{% endfor %}
  </div>
  <button class="zb-submit" type="button" data-zb="submit">Проверить</button>
  <div class="zb-back" data-zb-back hidden>{{ m.explanation(params) }}</div>
</div>
```

`style.css`

```css
.ap-list { display: grid; gap: 8px; }
.ap-item { justify-content: flex-start; }
.ap-art { min-width: 2.2em; color: var(--zb-ink-2); }
.ap-item.ok  { border-color: var(--zb-good); color: var(--zb-good); background: var(--zb-good-bg); }
.ap-item.bad { border-color: var(--zb-bad);  color: var(--zb-bad);  background: var(--zb-bad-bg); }
```

`logic.js`

```js
export default function (zb) {
  const rows = zb.$$('.ap-item');
  const picked = zb.params.items.map(() => 'a');
  rows.forEach((row, i) => row.addEventListener('click', () => {
    if (zb.answered) return;
    picked[i] = picked[i] === 'a' ? 'an' : 'a';
    row.querySelector('.ap-art').textContent = picked[i];
  }));
  // The standard «Проверить» button (data-zb="submit") and Enter send the answer.
  zb.on('submit', () => zb.answer({ picked }));
  // marks.rows comes back from check() below.
  zb.on('graded', (m) => rows.forEach((row, i) => row.classList.add(m.marks && m.marks.rows && m.marks.rows[i] ? 'ok' : 'bad')));
}

// Runs inside the frame when zb.answer() is called; the app turns the verdict into a grade.
export function check(answer, params) {
  const right = String(params.answer).split(' · ');
  const rows = params.items.map((word, i) => `${answer.picked[i]} ${word}` === right[i]);
  const score = rows.filter(Boolean).length / rows.length;
  return { score, expected: params.answer, marks: { rows } };
}
```

Задание в `card.yaml`:

```yaml
- id: e6
  template: ./views/article-pick
  skill: apply
  status: ready
  params:
    items: [apple, hour, cat, university]
    answer: an apple · an hour · a cat · a university
    explanation: Важен **звук**, а не буква — *an hour*, *a university*.
```

Что проверено (Chromium, текущий код): ответ `{ picked: [an, an, a, a] }` → `score 1` → Good, все строки зелёные,
кнопки заблокированы, оборот с пояснением открыт; одна ошибка → `score 0.75` → Hard (отправка по Enter);
три ошибки → Again; исключение в `check()` → ошибка проверки, а не «верно».

Чтобы шаблон был у всей колоды — положите папку в `templates/article-pick/` и пишите `template: article-pick`.

### Б7. Подводные камни

- **Нажатия на английские слова.** Каждое английское слово оборачивается для перевода по нажатию. Вне кнопок,
  ссылок, полей и фишек нажатие на слово открывает перевод, а не ваш обработчик. Делайте нажимаемые элементы
  `<button>` или ставьте им `data-zb-tap`; в обработчиках используйте `e.target.closest(...)` — цель нажатия
  может быть `<span data-w>`.
- **Блокировка.** После ответа сами блокируются только `data-zb-*` элементы и элементы с `data-zb-lock`;
  в своих обработчиках проверяйте `zb.answered`.
- **Своя кнопка «Проверить».** `data-zb="submit"` при фишках или полях отправляет их сам; иначе вызывает `submit`
  для logic.js. Если в шаблоне есть `data-zb-input`, но ответ вы собираете сами — используйте свою кнопку без `data-zb`.
- **Ответ показывается как текст.** `expected` (или `params.answer`) — строка, её видит ученик после ошибки и при
  «Не знаю»; храните ответ в читаемом виде.
- **Перевод слов в параметрах.** Все строки `params` проверяются на незнакомые слова (Rule B) и на грамматику
  (Rule G) — так же, как у встроенных шаблонов.
- **Обратная сторона** после ответа показывается шаблоном `back` (карточка с примерами), а не вашим view.

---

## Что пока нельзя

Задумано в `spec.html`, но не реализовано: рецепты черновиков и «+ Задание» с формой по `params`, `extends` и блоки,
пакеты шаблонов (`templates: [core, gh:…]`), каталог по `examples.yaml`, хуки приложения, `zb.store`,
`zb.override`, `zb.bury`, события кроме `ready`, `submit`, `graded`.

---

## Неполадки

| симптом | причина |
|---|---|
| задание не появляется в сессии | `status` не `ready`; навык не на лестнице (`skill` / `trains`); `modes` не включает режим; задание ждёт слово (Rule B), правило (Rule G) или `needs`; карточка ещё не введена |
| правило не приходит | тема не в `deck.yaml topics:` или не `kind: grammar`; не открыта по `requires`; предыдущее правило темы не выучено; дневной лимит `new_rules_per_day` |
| «Шаблон «x» не найден» | опечатка в id; `./views/x` ищется только в папке карточки; нет `view.njk` |
| «Ошибка в шаблоне» | ошибка Nunjucks в view.njk — текст в превью карточки |
| в сессии «Задание не смогло проверить ответ», ученик оценивает себя сам; в превью «Ошибка проверки» | `check: custom`, но `check()` бросает или не экспортирована (`export function check` или `export const check =`), или неизвестный тип проверки; подробности в Профиль → Журнал отладки |
| «неизвестный тип проверки» | опечатка в `check.type`; допустимы `choice`, `tokens`, `fuzzy`, `exact`, `pairs`, `md`, `custom`, `manual`, `ai`, `none` |
| нажатие ничего не делает | элемент не `<button>` — нажатие ушло в перевод слова; добавьте `data-zb-tap` |
| logic.js не запускается | `import` или синтаксис модуля в logic.js; ошибка видна в «Журнале отладки» (`frame error`) |
| validate_deck: `missing params` | не хватает параметра, помеченного `required` в манифесте |
| validate_deck: `warning: … never asked` | навык не на лестнице колоды |
