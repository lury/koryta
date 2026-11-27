from util.cf_access import ID_HEADER, SECRET_HEADER, access_headers, site_session


def test_no_headers_without_a_token(monkeypatch):
    monkeypatch.delenv("CF_ACCESS_CLIENT_ID", raising=False)
    monkeypatch.delenv("CF_ACCESS_CLIENT_SECRET", raising=False)
    assert access_headers() == {}
    assert ID_HEADER not in site_session().headers


def test_both_halves_or_nothing(monkeypatch):
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "id.access")
    monkeypatch.delenv("CF_ACCESS_CLIENT_SECRET", raising=False)
    assert access_headers() == {}


def test_session_sends_the_service_token(monkeypatch):
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "id.access")
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", "s3cret")
    session = site_session()
    assert session.headers[ID_HEADER] == "id.access"
    assert session.headers[SECRET_HEADER] == "s3cret"
