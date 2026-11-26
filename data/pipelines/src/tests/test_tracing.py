import pytest

import tracing
from tracing import setup_tracing, traced


@pytest.fixture(autouse=True)
def tracing_off(monkeypatch):
    monkeypatch.setattr(tracing, "_tracer", None)


def test_off_without_the_endpoint(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    assert setup_tracing() is False


def test_traced_only_calls_the_function_when_off():
    @traced("never a span")
    def double(x: int) -> int:
        return 2 * x

    assert double(21) == 42


class _Tracer:
    def __init__(self):
        self.names: list[str] = []

    def start_as_current_span(self, name):
        self.names.append(name)
        return _Span()


class _Span:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_traced_names_the_span_from_the_call(monkeypatch):
    tracer = _Tracer()
    monkeypatch.setattr(tracing, "_tracer", tracer)

    @traced(lambda name: f"pipeline {name}")
    def run(name: str) -> str:
        return name

    assert run("PeopleMerged") == "PeopleMerged"
    assert tracer.names == ["pipeline PeopleMerged"]
