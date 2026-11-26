"""One spelling per article, so the same story found twice is crawled once."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

#: Query parameters that track the click, not the page.
_TRACKING = frozenset(
    {
        "fbclid",
        "gclid",
        "dclid",
        "msclkid",
        "yclid",
        "mc_cid",
        "mc_eid",
        "igshid",
        "ocid",
        "oc",
        "ref",
        "ref_src",
        "smid",
        "cmpid",
        "_ga",
    }
)


def _tracking(name: str) -> bool:
    lowered = name.lower()
    return lowered in _TRACKING or lowered.startswith(("utm_", "at_", "pk_"))


def normalize_url(url: str) -> str:
    """https, lowercase host without www, no fragment, no tracking, no AMP.

    The path keeps its case: plenty of Polish CMSes serve `/Artykul/` and
    `/artykul/` as two pages.
    """
    raw = url.strip()
    if "://" not in raw:
        raw = "https://" + raw
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("amp."):
        host = host[4:]
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"
    path = parts.path or "/"
    for suffix in ("/amp", "/amp/", ".amp"):
        if path.endswith(suffix) and len(path) > len(suffix):
            path = path[: -len(suffix)]
            break
    if len(path) > 1:
        path = path.rstrip("/")
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not _tracking(k) and k.lower() != "amp"
    ]
    return urlunsplit(("https", host, path, urlencode(sorted(query)), ""))


def url_key(url: str) -> str:
    """The dedupe key: `normalize_url` without the scheme, as `ArticleDoneUrls`
    compares, and with the root's slash gone."""
    normalized = normalize_url(url)
    return normalized.split("://", 1)[1].rstrip("/")


def domain_of(url: str) -> str:
    host = (urlsplit(normalize_url(url)).hostname or "").lower()
    return host
