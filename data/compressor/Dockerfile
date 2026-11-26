# Keep in step with the go directive in go.mod, which is what actually gates
# the build.
FROM golang:1.25.14-alpine3.24 AS builder

WORKDIR /app

# Dependencies first, so a change to the source does not refetch them.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -o compressor ./cmd/compressor

# alpine ships ca-certificates-bundle, which the GCS client needs for TLS.
FROM alpine:3.24.3

# The binary belongs to root and stays read-only; the user may write only
# /data, where -cpuprofile and -memprofile land when given a relative path.
RUN addgroup -S -g 10001 compressor \
    && adduser -S -D -H -u 10001 -G compressor -h /data compressor \
    && mkdir /data \
    && chown compressor:compressor /data

COPY --from=builder /app/compressor /usr/local/bin/compressor

USER compressor:compressor
WORKDIR /data

ENTRYPOINT ["/usr/local/bin/compressor"]
