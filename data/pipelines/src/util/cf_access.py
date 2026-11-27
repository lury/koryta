"""Requests to a site behind Cloudflare Access.

The private demo (frontend/docs/postgres/README.md, "Demo na własnym
serwerze") lets through only people on an e-mail allowlist and automation
holding an Access service token. A run uploading there sets
``CF_ACCESS_CLIENT_ID`` and ``CF_ACCESS_CLIENT_SECRET``; every request to the
site then carries them, and nothing changes for production, which sets
neither.

Only for requests to the site: the token is a secret of that deployment and
goes to no other host (Google's sign-in, the scraped sources).
"""

import os

import requests

ID_HEADER = "CF-Access-Client-Id"
SECRET_HEADER = "CF-Access-Client-Secret"


def access_headers() -> dict[str, str]:
    """The service-token headers, or none when the environment has none."""
    client_id = os.environ.get("CF_ACCESS_CLIENT_ID")
    secret = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if not client_id or not secret:
        return {}
    return {ID_HEADER: client_id, SECRET_HEADER: secret}


def site_session() -> requests.Session:
    """A session for requests to the site, with the headers above."""
    session = requests.Session()
    session.headers.update(access_headers())
    return session
