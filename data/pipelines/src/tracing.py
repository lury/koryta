"""Spans of a pipeline run, for a local Jaeger (compose.tracing.yaml).

Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set and the `tracing` group is
installed (`uv sync --group tracing`). Off, `traced` costs one flag check per
call and nothing is imported.

    OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \\
        .venv/bin/koryta --pipeline PeopleMerged
"""

import functools
import os
import typing

SERVICE_NAME = "koryta-pipelines"

_tracer: typing.Any = None


def setup_tracing() -> bool:
    """Send spans to OTEL_EXPORTER_OTLP_ENDPOINT, with every requests and
    httpx call as a span of its own. True when tracing is on."""
    global _tracer
    if _tracer is not None:
        return True
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False
    try:
        from opentelemetry import trace  # noqa: PLC0415
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: PLC0415
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.httpx import (  # noqa: PLC0415
            HTTPXClientInstrumentor,
        )
        from opentelemetry.instrumentation.requests import (  # noqa: PLC0415
            RequestsInstrumentor,
        )
        from opentelemetry.sdk.resources import Resource  # noqa: PLC0415
        from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
        from opentelemetry.sdk.trace.export import (  # noqa: PLC0415
            BatchSpanProcessor,
        )
    except ImportError:
        print(
            "OTEL_EXPORTER_OTLP_ENDPOINT is set, but the tracing group is not "
            "installed: uv sync --group tracing"
        )
        return False

    resource = Resource.create(
        {"service.name": os.environ.get("OTEL_SERVICE_NAME", SERVICE_NAME)}
    )
    provider = TracerProvider(resource=resource)
    # The exporter reads the endpoint and appends /v1/traces itself.
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    RequestsInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
    _tracer = trace.get_tracer("koryta.pipelines")
    return True


P = typing.ParamSpec("P")
R = typing.TypeVar("R")


def traced(
    name: str | typing.Callable[..., str],
) -> typing.Callable[[typing.Callable[P, R]], typing.Callable[P, R]]:
    """Run the function in a span called `name`, or `name(*args)` when it is
    a function of the call's arguments, once `setup_tracing` turned it on.

    The check is per call rather than at decoration, since modules decorate
    on import and `setup_tracing` runs later, from `setup_context`."""

    def decorate(fn: typing.Callable[P, R]) -> typing.Callable[P, R]:
        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            if _tracer is None:
                return fn(*args, **kwargs)
            span_name = name(*args, **kwargs) if callable(name) else name
            with _tracer.start_as_current_span(span_name):
                return fn(*args, **kwargs)

        return wrapper

    return decorate
