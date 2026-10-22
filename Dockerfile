# One image with voice's three programs: the api, the brain and the node.
# compose.yaml picks which one each service runs.
#
# The build stage takes a Linux hale toolchain from the build context
# (`.hale-toolchain/`: `hale` and `libhale_ts_shim.a`) rather than compiling
# the compiler in the image: `hale` statically links LLVM and needs only
# clang, libc and OpenSSL headers beside it (see hale's own Dockerfile).
# CI builds hale at the commit in hale.pin once, caches it, and hands it
# in; locally, `scripts/hale-toolchain.sh` makes the directory (the pin, or
# `--release <tag>`), then `docker compose build`.

# The admin UI, built once and served by the api from its own origin.
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ui/tsconfig.base.json ./
COPY ui/packages ./packages
COPY ui/apps ./apps
COPY spec /spec
RUN npm ci && npm run build

FROM ubuntu:24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl clang-18 libc6-dev libssl-dev \
      libffi8 libtinfo6 libzstd1 zlib1g-dev libstdc++6 \
    && ln -s /usr/bin/clang-18 /usr/bin/clang \
    && rm -rf /var/lib/apt/lists/*
COPY .hale-toolchain/hale .hale-toolchain/libhale_ts_shim.a /usr/local/bin/
RUN hale --version

WORKDIR /src
COPY lib lib
COPY store store
COPY api api
COPY brain brain
COPY node node
COPY deploy/node deploy/node
RUN hale test api && hale test node && hale test store && hale test brain \
    && hale build api && hale build brain && hale build node

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/api/api /usr/local/bin/voice-api
COPY --from=build /src/brain/brain /usr/local/bin/voice-brain
COPY --from=build /src/node/node /usr/local/bin/voice-node
COPY store/migrations /usr/share/voice/migrations
COPY --from=ui /ui/apps/admin/dist /usr/share/voice/ui
