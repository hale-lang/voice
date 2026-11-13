# One image with voice's three programs: the api, the brain and the node.
# compose.yaml picks which one each service runs.
#
# The build stages use hale's released Linux toolchain rather than building
# the compiler: `hale` statically links LLVM and needs only clang, libc and
# OpenSSL headers beside it (see hale's own Dockerfile).
#
# The build is incremental: each program is compiled in a stage of its own
# and tested in another, each copying only the sources it reads, so a
# change to one program compiles only that program again (and re-runs the
# tests that import it), while the toolchain, its packages and the other
# programs come from the layer cache. BuildKit runs the stages in parallel.

# the release hale.toml declares ([dna] toolchain); CI checks they agree
ARG HALE_VERSION=v0.32.12

# The admin UI, built once and served by the api from its own origin. Its
# dependencies are installed from the manifests alone, so a change to the
# UI's sources builds it again without installing them again; npm's
# download cache is kept between builds.
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ui/tsconfig.base.json ./
COPY ui/packages/tokens/package.json packages/tokens/
COPY ui/packages/components/package.json packages/components/
COPY ui/apps/admin/package.json apps/admin/
RUN --mount=type=cache,id=voice-npm,target=/root/.npm npm ci
COPY ui/packages ./packages
COPY ui/apps ./apps
COPY spec /spec
RUN npm run build

# The toolchain: packages, then the release HALE_VERSION names (a layer of
# its own, downloaded again only when the version changes), then the shared
# libraries every program imports.
FROM ubuntu:24.04 AS hale
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl clang-18 libc6-dev libssl-dev \
      libffi8 libtinfo6 libzstd1 zlib1g-dev libstdc++6 \
    && ln -s /usr/bin/clang-18 /usr/bin/clang \
    && rm -rf /var/lib/apt/lists/*
ARG HALE_VERSION
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) arch=aarch64 ;; \
      amd64) arch=x86_64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    name="hale-${HALE_VERSION}-${arch}-unknown-linux-gnu.tar.gz"; \
    base="https://github.com/hale-lang/hale/releases/download/${HALE_VERSION}"; \
    cd /tmp; \
    curl -fsSLO "$base/$name"; \
    curl -fsSLO "$base/$name.sha256"; \
    sha256sum -c "$name.sha256"; \
    tar xzf "$name" -C /usr/local/bin ./hale ./libhale_ts_shim.a; \
    rm -f "$name" "$name.sha256"; \
    hale --version
WORKDIR /src
COPY lib lib

# the store, which the api and the brain import
FROM hale AS store
COPY store store

# Every compile below mounts hale's cache of compiled runtime objects
# (~/.cache/hale/runtime), content-addressed by their C source, flags and
# compiler, so a build reuses those an earlier one compiled; `private`, so
# stages running side by side never write one cache at once.
#
# Each program's binary, from its own sources and what it imports.
FROM store AS build-api
COPY api api
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale build --target-cpu baseline api

FROM store AS build-brain
COPY brain brain
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale build --target-cpu baseline brain

FROM hale AS build-node
COPY node node
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale build --target-cpu baseline node

# Each program's tests, beside its build, with what they import and the
# files they read; each ends in an empty /tested. The api's tests import the
# node, and the brain's the api: a change to the node runs the api's tests
# again, one to the api the brain's, but compiles no other binary.
FROM store AS test-store
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale test store && mkdir /tested

FROM store AS test-api
COPY node node
COPY api api
# the recipe fixtures the api's tests share with the contract check
COPY spec/validate/recipes spec/validate/recipes
COPY spec/validate/runtimes spec/validate/runtimes
# what voice ships, which the tests hold placements to (memory_budget_test)
# and suggest from (pair_placement_test)
COPY runtimes runtimes
COPY recipes recipes
COPY catalog catalog
# the test's fake harness (attempts_test)
COPY scripts/e2e-harnesses scripts/e2e-harnesses
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale test api && mkdir /tested

FROM store AS test-brain
COPY api api
COPY brain brain
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale test brain && mkdir /tested

FROM hale AS test-node
COPY node node
COPY deploy/node deploy/node
# the harness definitions voice ships, and the test's fake (harness_test,
# attempt_failure_test)
COPY harnesses harnesses
COPY scripts/e2e-harnesses scripts/e2e-harnesses
RUN --mount=type=cache,id=voice-hale-runtime,sharing=private,target=/root/.cache/hale/runtime \
    hale test node && mkdir /tested

# The image takes each binary once the tests that cover it pass: these
# stages wait on them by mounting their /tested, and change nothing. Tests
# that run again and pass leave the binary, and the image, as they were.
FROM build-api AS api-tested
RUN --mount=type=bind,from=test-store,source=/tested,target=/tested/store \
    --mount=type=bind,from=test-api,source=/tested,target=/tested/api \
    true

FROM build-brain AS brain-tested
RUN --mount=type=bind,from=test-store,source=/tested,target=/tested/store \
    --mount=type=bind,from=test-brain,source=/tested,target=/tested/brain \
    true

FROM build-node AS node-tested
RUN --mount=type=bind,from=test-node,source=/tested,target=/tested/node \
    true

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=api-tested /src/api/api /usr/local/bin/voice-api
COPY --from=brain-tested /src/brain/brain /usr/local/bin/voice-brain
COPY --from=node-tested /src/node/node /usr/local/bin/voice-node
COPY store/migrations /usr/share/voice/migrations
COPY --from=ui /ui/apps/admin/dist /usr/share/voice/ui
COPY recipes /usr/share/voice/recipes
COPY catalog /usr/share/voice/catalog
COPY runtimes /usr/share/voice/runtimes
COPY harnesses /usr/share/voice/harnesses
