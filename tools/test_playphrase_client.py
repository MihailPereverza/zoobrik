import json
import uuid
from pathlib import Path
from urllib.parse import urlparse

import pytest

from playphrase_client import (
    BotCheck,
    PlayPhraseClient,
    PlayPhraseError,
    evaluate_check_bot,
    extract_app_script_url,
    extract_csrf_token,
    main,
)

SEARCH_PATH = '/api/v1/phrases/search'
COMMON_PATH = '/api/v1/phrases/common-phrases'
APP_JS_PATH = '/js/app.js'

_USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36'
)

_HOME_HTML = (
    '<script>var appScriptUrl = "/js/app.js?r=33007654";'
    'var csrfToken = "html-csrf-token";</script>'
)
_APP_JS = (
    'function bQb(){return"app-js-csrf-token"}'
    'function dQb(a){return new k(null,2,["authorization",["Token ",I2()].join(""),'
    '"x-csrf-token",bQb()],null)}'
)

_SEARCH_PAYLOAD = {'count': 1, 'phrases': [{'text': 'in the morning'}]}
_COMMON_PAYLOAD = [{'text': 'Good morning', 'translate': 'Доброе утро'}]
_VIDEO_CONTENT = b'\x00\x01video-bytes'


class FakeResponse:
    """Ответ-заглушка с полями, которые использует клиент"""

    def __init__(self, *, status_code: int = 200, payload=None, text: str = '') -> None:
        self.status_code = status_code
        if payload is not None:
            text = json.dumps(payload)
        self.text = text
        self.content = self.text.encode()

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self):
        return json.loads(self.text)


class FakeSession:
    """Сессия-заглушка: маршруты по пути URL и запись вызовов"""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self._routes: dict[str, list[FakeResponse]] = {}

    def add(self, path: str, *responses: FakeResponse) -> None:
        self._routes.setdefault(path, []).extend(responses)

    def paths(self) -> list[str]:
        return [call['path'] for call in self.calls]

    def call(self, path: str) -> dict:
        for call in self.calls:
            if call['path'] == path:
                return call
        raise AssertionError(f'Нет вызова {path}')

    def get(self, url: str, **kwargs) -> FakeResponse:
        path = urlparse(url).path
        self.calls.append({'path': path, **kwargs})
        queue = self._routes.get(path)
        if not queue:
            raise AssertionError(f'Неожиданный запрос: {url}')
        return queue.pop(0)


def _new_client(session: FakeSession) -> PlayPhraseClient:
    session.add('/', FakeResponse(text=_HOME_HTML))
    session.add(APP_JS_PATH, FakeResponse(text=_APP_JS))
    return PlayPhraseClient(session=session)


class TestExtractAppScriptUrl:
    """extract_app_script_url: путь app.js из inline-переменных главной страницы"""

    def test_present__returns_path(self):
        # act & assert
        assert extract_app_script_url(_HOME_HTML) == '/js/app.js?r=33007654'

    def test_missing__raises(self):
        # act & assert
        with pytest.raises(PlayPhraseError):
            extract_app_script_url('<html></html>')


class TestExtractCsrfToken:
    """extract_csrf_token: токен из функции рядом с x-csrf-token в app.js"""

    def test_present__returns_token(self):
        # act & assert
        assert extract_csrf_token(_APP_JS) == 'app-js-csrf-token'

    def test_missing__raises(self):
        # act & assert
        with pytest.raises(PlayPhraseError):
            extract_csrf_token('var x = 1')


class TestEvaluateCheckBot:
    """evaluate_check_bot: UA-эвристики check-bot.js -> BotCheck"""

    def test_desktop_chrome__not_blocked(self):
        # act & assert
        assert evaluate_check_bot(_USER_AGENT) == BotCheck(blocked=False, reason='human')

    @pytest.mark.parametrize(
        ('user_agent', 'reason'),
        [
            pytest.param('Mozilla/5.0 Googlebot/2.1', 'known-bot-ua', id='bot_ua'),
            pytest.param(
                'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/150.0',
                'headless-ua',
                id='headless',
            ),
        ],
    )
    def test_bad_ua__blocked(self, user_agent, reason):
        # act & assert
        assert evaluate_check_bot(user_agent) == BotCheck(blocked=True, reason=reason)


class TestSearch:
    """PlayPhraseClient.search: параметры, заголовки и порядок запросов"""

    def test_cold_start__initializes_session_before_query(self):
        # arrange
        session = FakeSession()
        session.add(SEARCH_PATH, FakeResponse(payload=_SEARCH_PAYLOAD))
        client = _new_client(session)

        # act
        result = client.search(query='in the morning')

        # assert
        assert result == _SEARCH_PAYLOAD
        assert session.paths() == ['/', APP_JS_PATH, SEARCH_PATH]

    def test_second_call__reuses_session(self):
        # arrange
        session = FakeSession()
        session.add(
            SEARCH_PATH,
            FakeResponse(payload=_SEARCH_PAYLOAD),
            FakeResponse(payload=_SEARCH_PAYLOAD),
        )
        client = _new_client(session)
        client.search(query='in the morning')

        # act
        client.search(query='in the morning')

        # assert
        assert session.paths().count('/') == 1

    def test_sends_browser_api_headers(self):
        # arrange
        session = FakeSession()
        session.add(SEARCH_PATH, FakeResponse(payload=_SEARCH_PAYLOAD))
        client = _new_client(session)

        # act
        client.search(query='in the morning')

        # assert
        headers = session.call(SEARCH_PATH)['headers']
        assert headers['x-csrf-token'] == 'app-js-csrf-token'
        assert headers['authorization'] == 'Token'
        assert headers['sec-fetch-mode'] == 'cors'
        assert headers['user-agent'] == _USER_AGENT

    def test_passes_query_params(self):
        # arrange
        session = FakeSession()
        session.add(SEARCH_PATH, FakeResponse(payload=_SEARCH_PAYLOAD))
        client = _new_client(session)

        # act
        client.search(query='in the morning', limit=5, skip=10)

        # assert
        params = session.call(SEARCH_PATH)['params']
        assert params == {
            'q': 'in the morning',
            'limit': 5,
            'language': 'en',
            'platform': 'desktop safari',
            'skip': 10,
            'request-id': params['request-id'],
            'hideHardOffensiveIn17Plus': 'false',
            'hideExplicitNudityIn17Plus': 'false',
        }
        uuid.UUID(params['request-id'].removeprefix('search-session-'))

    def test_stale_session_403__refreshes_and_retries(self):
        # arrange
        session = FakeSession()
        session.add(
            '/',
            FakeResponse(text=_HOME_HTML),
            FakeResponse(text=_HOME_HTML),
        )
        session.add(
            APP_JS_PATH,
            FakeResponse(text=_APP_JS),
            FakeResponse(text=_APP_JS),
        )
        session.add(
            SEARCH_PATH,
            FakeResponse(status_code=403, text='Old page, reload'),
            FakeResponse(payload=_SEARCH_PAYLOAD),
        )
        client = _new_client(session)

        # act
        result = client.search(query='in the morning')

        # assert
        assert result == _SEARCH_PAYLOAD
        assert session.paths() == [
            '/',
            APP_JS_PATH,
            SEARCH_PATH,
            '/',
            APP_JS_PATH,
            SEARCH_PATH,
        ]

    def test_http_error__raises_playphrase_error(self):
        # arrange
        session = FakeSession()
        session.add(SEARCH_PATH, FakeResponse(status_code=500, text='boom'))
        client = _new_client(session)

        # act & assert
        with pytest.raises(PlayPhraseError, match='500'):
            client.search(query='in the morning')

    def test_bot_user_agent__blocked_before_requests(self):
        # arrange
        session = FakeSession()
        client = PlayPhraseClient(session=session, user_agent='Googlebot/2.1')

        # act & assert
        with pytest.raises(PlayPhraseError, match='check-bot'):
            client.search(query='in the morning')
        assert session.calls == []


class TestCommonPhrases:
    """PlayPhraseClient.common-phrases: параметры запроса"""

    def test_sends_language_and_translate_to(self):
        # arrange
        session = FakeSession()
        session.add(COMMON_PATH, FakeResponse(payload=_COMMON_PAYLOAD))
        client = _new_client(session)

        # act
        result = client.common_phrases(query='in the morning', translate_to='ru')

        # assert
        assert result == _COMMON_PAYLOAD
        params = session.call(COMMON_PATH)['params']
        assert params == {'q': 'in the morning', 'language': 'en', 'translate-to': 'ru'}

    def test_without_translate_to__omits_param(self):
        # arrange
        session = FakeSession()
        session.add(COMMON_PATH, FakeResponse(payload=_COMMON_PAYLOAD))
        client = _new_client(session)

        # act
        client.common_phrases(query='hello')

        # assert
        params = session.call(COMMON_PATH)['params']
        assert params == {'q': 'hello', 'language': 'en'}


class TestDownloadVideo:
    """PlayPhraseClient.download_video: сохранение видеофрагмента"""

    def test_writes_content_to_destination(self, tmp_path: Path):
        # arrange
        session = FakeSession()
        session.add('/video/eng/abc/clip.mp4', FakeResponse(text=_VIDEO_CONTENT.decode('latin-1')))
        client = _new_client(session)
        client.start_session()

        # act
        result = client.download_video(
            video_url='https://www.playphrase.me/video/eng/abc/clip.mp4',
            dest=tmp_path / 'clip.mp4',
        )

        # assert
        assert result == tmp_path / 'clip.mp4'
        assert result.read_bytes() == _VIDEO_CONTENT


class TestMain:
    """main: CLI-обёртка над клиентом"""

    def test_common_flag__prints_json(self, monkeypatch, capsys):
        # arrange
        monkeypatch.setattr(
            'playphrase_client.PlayPhraseClient',
            lambda: _FakeClient(common=_COMMON_PAYLOAD),
        )

        # act
        code = main(['hello', '--common', '--translate-to', 'ru'])

        # assert
        assert code == 0
        assert json.loads(capsys.readouterr().out) == _COMMON_PAYLOAD

    def test_client_error__exit_code_1(self, monkeypatch, capsys):
        # arrange
        monkeypatch.setattr(
            'playphrase_client.PlayPhraseClient',
            lambda: _FakeClient(fail=True),
        )

        # act
        code = main(['hello'])

        # assert
        assert code == 1
        assert 'Ошибка' in capsys.readouterr().err


class _FakeClient:
    """Клиент-заглушка для CLI-тестов"""

    def __init__(self, *, common=None, fail: bool = False) -> None:
        self._common = common
        self._fail = fail

    def search(self, **kwargs):
        if self._fail:
            raise PlayPhraseError('boom')
        return _SEARCH_PAYLOAD

    def common_phrases(self, **kwargs):
        if self._fail:
            raise PlayPhraseError('boom')
        return self._common
