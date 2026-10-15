"""playphrase.me client without a browser: opens a session like a browser visit, then searches and downloads clips.

Usage: playphrase_client.py <query> [--limit N] [--skip N] [--common [--translate-to ru]]
       playphrase_client.py <query> --download-video <url> --out <file>

The session is a cookie plus the CSRF token from app.js, kept in memory only. tools/clips.py builds on it.
"""

import argparse
import json
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

BASE_URL = 'https://www.playphrase.me'
DEFAULT_USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36'
)
APP_SCRIPT = re.compile(r'appScriptUrl\s*=\s*["\']([^"\']+)["\']')
CSRF_HEADER = re.compile(r'"x-csrf-token",([A-Za-z0-9_$]+)\(\)')
CSRF_FUNCTION = re.compile(r'function bQb\(\)\{return"([^"]+)"\}')
CSRF_ANY_FUNCTION = re.compile(r'function [A-Za-z0-9_$]+\(\)\{return"([A-Za-z0-9+/=]{40,})"\}')
BOT_MARKERS = (('headless', 'headless-ua'), ('bot', 'known-bot-ua'), ('spider', 'known-bot-ua'),
               ('crawl', 'known-bot-ua'), ('webdriver', 'webdriver-ua'))


class PlayPhraseError(RuntimeError):
    """playphrase.me refused or answered something the client cannot use."""


@dataclass
class BotCheck:
    """What the site's check-bot heuristics would say about a user agent."""

    blocked: bool
    """The site would treat the user agent as a bot."""
    reason: str
    """headless-ua, known-bot-ua, webdriver-ua or human."""


def extract_app_script_url(home_html: str) -> str:
    match = APP_SCRIPT.search(home_html)
    if not match:
        raise PlayPhraseError('no app.js on the home page')
    return match.group(1)


def extract_csrf_token(app_js: str) -> str:
    """The token the function next to x-csrf-token returns; older builds named it bQb, else any long literal."""
    header = CSRF_HEADER.search(app_js)
    if header:
        definition = re.search(rf'function {re.escape(header.group(1))}\(\)\{{return"([^"]+)"\}}', app_js)
        if definition:
            return definition.group(1)
    match = CSRF_FUNCTION.search(app_js) or CSRF_ANY_FUNCTION.search(app_js)
    if not match:
        raise PlayPhraseError('no x-csrf-token in app.js')
    return match.group(1)


def evaluate_check_bot(user_agent: str) -> BotCheck:
    lowered = user_agent.lower()
    reason = next((reason for marker, reason in BOT_MARKERS if marker in lowered), '')
    return BotCheck(blocked=bool(reason), reason=reason or 'human')


def raise_for_status(response: Any) -> None:
    status = getattr(response, 'status_code', 200)
    if status >= 400:
        raise PlayPhraseError(f'HTTP {status}: {getattr(response, "text", "")[:500]}')


class PlayPhraseClient:
    """HTTP client of playphrase.me; the session opens on the first call."""

    def __init__(self, *, session: Any | None = None, user_agent: str = DEFAULT_USER_AGENT,
                 base_url: str = BASE_URL) -> None:
        self.session = session if session is not None else requests.Session()
        self.user_agent = user_agent
        self.base_url = base_url.rstrip('/')
        self.csrf_token: str | None = None

    def start_session(self) -> None:
        self.check_bot()
        home = self.session.get(f'{self.base_url}/', headers={'user-agent': self.user_agent}, timeout=30)
        raise_for_status(home)
        app_path = extract_app_script_url(home.text)
        app_url = app_path if app_path.startswith('http') else f'{self.base_url}{app_path}'
        app_js = self.session.get(app_url, headers=self.page_headers(), timeout=60)
        raise_for_status(app_js)
        self.csrf_token = extract_csrf_token(app_js.text)

    def search(self, *, query: str, limit: int = 10, language: str = 'en', platform: str = 'desktop safari',
               skip: int = 0) -> dict[str, Any]:
        """One page of /phrases/search; a stale session ("Old page") is reopened once."""
        self.ensure_started()
        params = {
            'q': query, 'limit': limit, 'language': language, 'platform': platform, 'skip': skip,
            'request-id': f'search-session-{uuid.uuid4()}',
            'hideHardOffensiveIn17Plus': 'false', 'hideExplicitNudityIn17Plus': 'false',
        }
        response = self.api_get(path='/api/v1/phrases/search', params=params)
        if response.status_code == 403 and 'Old page' in response.text:
            self.start_session()
            response = self.api_get(path='/api/v1/phrases/search', params=params)
        raise_for_status(response)
        return response.json()

    def common_phrases(self, *, query: str, language: str = 'en',
                       translate_to: str | None = None) -> list[dict[str, Any]]:
        self.ensure_started()
        params = {'q': query, 'language': language}
        if translate_to:
            params['translate-to'] = translate_to
        response = self.api_get(path='/api/v1/phrases/common-phrases', params=params)
        raise_for_status(response)
        return response.json()

    def download_video(self, *, video_url: str, dest: Path) -> Path:
        self.ensure_started()
        response = self.session.get(video_url, headers=self.page_headers(), timeout=60)
        raise_for_status(response)
        payload = response.content if isinstance(response.content, bytes) else response.text.encode()
        dest = Path(dest)
        dest.write_bytes(payload)
        return dest

    def ensure_started(self) -> None:
        self.check_bot()
        if self.csrf_token is None:
            self.start_session()

    def check_bot(self) -> None:
        check = evaluate_check_bot(self.user_agent)
        if check.blocked:
            raise PlayPhraseError(f'check-bot would block this user agent: {check.reason}')

    def page_headers(self) -> dict[str, str]:
        return {'user-agent': self.user_agent, 'referer': f'{self.base_url}/'}

    def api_headers(self) -> dict[str, str]:
        return {
            **self.page_headers(),
            'authorization': 'Token', 'x-csrf-token': self.csrf_token or '', 'accept': 'json',
            'content-type': 'json', 'origin': self.base_url, 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin', 'accept-language': 'ru,en;q=0.9',
        }

    def api_get(self, *, path: str, params: dict[str, Any]) -> Any:
        return self.session.get(f'{self.base_url}{path}', params=dict(params), headers=self.api_headers(), timeout=30)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='playphrase.me client without a browser')
    parser.add_argument('query', help='phrase to search for')
    parser.add_argument('--limit', type=int, default=10, help='results per page')
    parser.add_argument('--language', default='en', help='search language')
    parser.add_argument('--platform', default='desktop safari', help='platform the API is told')
    parser.add_argument('--skip', type=int, default=0, help='results to skip')
    parser.add_argument('--common', action='store_true', help='ask common-phrases instead of search')
    parser.add_argument('--translate-to', default=None, help='translation language for common-phrases')
    parser.add_argument('--download-video', default=None, help='video URL to download')
    parser.add_argument('--out', default=None, help='file for the downloaded video')
    return parser


def run(args: argparse.Namespace) -> Any:
    client = PlayPhraseClient()
    if args.download_video:
        if not args.out:
            raise PlayPhraseError('--download-video needs --out')
        return {'saved_to': str(client.download_video(video_url=args.download_video, dest=Path(args.out)))}
    if args.common:
        return client.common_phrases(query=args.query, language=args.language, translate_to=args.translate_to)
    return client.search(query=args.query, limit=args.limit, language=args.language, platform=args.platform,
                         skip=args.skip)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = run(args)
    except PlayPhraseError as error:
        print(f'Ошибка: {error}', file=sys.stderr)
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
