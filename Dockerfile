# Build stage runs on the build host and cross-compiles for the target arch,
# so multi-platform builds need no QEMU emulation.
FROM --platform=$BUILDPLATFORM oven/bun:1.3 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

ARG TARGETARCH
RUN case "$TARGETARCH" in \
      arm64) target="bun-linux-arm64" ;; \
      *) target="bun-linux-x64" ;; \
    esac && \
    bun build --compile --minify --target="$target" src/index.ts --outfile /app/resend-exporter

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /app/resend-exporter /usr/local/bin/resend-exporter
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/usr/local/bin/resend-exporter"]
