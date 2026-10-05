# Zoobrik

Изучение английских слов и грамматики: интервальные повторения FSRS (как в Anki), слово тренируется
несколькими разными заданиями за цикл, колода — папка YAML-файлов в git-репозитории.

- `docs/spec.html` — спецификация, `docs/deck-format.md` — контракт формата колоды и шаблонов.
- `web/` — веб-приложение (Svelte 5 + Vite). Сервер разработки читает и пишет колоду на диске.
- `core-templates/` — встроенные шаблоны заданий (manifest.yaml + view.njk + style.css [+ logic.js]).
- `decks/english-notebook/` — колода (отдельный git-репозиторий): 12 тем, 88 карточек, ~900 заданий, 443 аудио.
- `tools/` — `validate_deck.py` (проверка формата), `voice.py` (озвучка Kokoro на Mac).

## Запуск

```sh
cd web && npm install && npm run dev          # http://localhost:5173
ZOOBRIK_DECK=/path/to/deck npm run dev        # другая колода
npm run build && npm run serve                # сборка, доступ с телефона по сети: http://<ip-мака>:5180
```

## Колода

```sh
tools/.venv/bin/python tools/validate_deck.py decks/english-notebook     # формат и задания
tools/.venv-voice/bin/python tools/voice.py decks/english-notebook        # озвучить новые слова и примеры
```

Внутри приложения: «Настройки → Проверить колоду» рендерит каждое задание, решает его эталонным ответом
и проверяет аудио. «Синхронизировать» коммитит прогресс и журнал и делает pull/push, если у колоды есть remote:

```sh
cd decks/english-notebook && git remote add origin git@github.com:<you>/english-notebook.git && git push -u origin main
```

Для озвучки нужен `brew install espeak-ng` (уже установлен).

`app/` — Android-модуль (Jetpack Compose, `ru.zoobrik`), сборка через Gradle из корня.

## Телефон

Приложение: https://mihailpereverza.github.io/zoobrik/ (собирается GitHub Actions при каждом push в `web/` или `core-templates/`).

1. Выпустить fine-grained токен: GitHub → Settings → Developer settings → Fine-grained tokens → доступ только к
   `MihailPereverza/english-notebook`, Repository permissions → Contents: Read and write.
2. Открыть адрес на телефоне: Android (Chrome) — ⋮ → «Установить приложение»; iPhone (Safari) — «Поделиться» → «На экран Домой».
3. Ввести `MihailPereverza/english-notebook` и токен. Колода и прогресс кешируются на устройстве, работают офлайн,
   ответы уходят коммитами в репозиторий колоды.

Локальная копия колоды на Mac обновляется обычным `git pull` в `decks/english-notebook`.
