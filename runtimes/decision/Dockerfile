# Voice's decision runtime for Linux, one image per backend (cpu, vulkan,
# rocm, cuda): voice-decide, voice's server (the decide/ seed), and the
# scorer it runs, jev-score-v2, built by runtimes/decision/build.sh in a
# builder per backend, each held to a digest.
#
#   docker build -f runtimes/decision/Dockerfile --build-arg BACKEND=cpu .
#
# is the image: /decision-runtime, its program voice-decide, which the node
# runs with the weights at /models. `--target scorer --output
# type=local,dest=out` writes the scorer alone, out/decision-runtime.
ARG BACKEND=cpu
# the release hale.toml declares ([dna] toolchain); CI checks they agree
ARG HALE_VERSION=v0.32.0

# CPU and Vulkan: Ubuntu 24.04, with the Vulkan headers, loader and shader
# compiler for Vulkan. GCC 14, as llama.cpp's own images: 13 cannot build
# the CPU code for the newest Arm cores (SME)
FROM docker.io/library/ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852 AS builder-cpu
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc-14 g++-14 cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CC=gcc-14 CXX=g++-14

FROM builder-cpu AS builder-vulkan
RUN apt-get update && apt-get install -y --no-install-recommends libvulkan-dev glslc spirv-headers \
    && rm -rf /var/lib/apt/lists/*

# CUDA 12.8, as llama.cpp's own CUDA images: drivers 570 and later
FROM docker.io/nvidia/cuda:12.8.1-devel-ubuntu24.04@sha256:520292dbb4f755fd360766059e62956e9379485d9e073bbd2f6e3c20c270ed66 AS builder-cuda
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc-14 g++-14 cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CC=gcc-14 CXX=g++-14 CUDAHOSTCXX=g++-14

# ROCm 6.4 (hipBLAS and rocBLAS with it), x86_64 only: its own compiler
# builds the GPU code, the system's GCC 13 the rest
FROM docker.io/rocm/dev-ubuntu-24.04:6.4.4-complete@sha256:31418ac10a3769a71eaef330c07280d1d999d7074621339b8f93c484c35f6078 AS builder-rocm
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM builder-${BACKEND} AS build
ARG BACKEND
COPY runtimes/decision /src
RUN /src/build.sh "$BACKEND" /out

FROM scratch AS scorer
COPY --from=build /out/decision-runtime /decision-runtime

# voice-decide, by hale's released toolchain, as the repo's Dockerfile
# builds voice's other programs
FROM docker.io/library/ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852 AS serve
ARG HALE_VERSION
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl clang-18 libc6-dev libssl-dev \
      libffi8 libtinfo6 libzstd1 zlib1g-dev libstdc++6 \
    && ln -s /usr/bin/clang-18 /usr/bin/clang \
    && rm -rf /var/lib/apt/lists/*
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
COPY decide decide
RUN hale test decide && hale build decide

# what each backend's image runs on: the libraries its build loads (OpenMP
# for the CPU's code, the Vulkan loader and Mesa's drivers, CUDA's or ROCm's
# runtime) and OpenSSL for the server
FROM docker.io/library/ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852 AS runtime-cpu
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libssl3 \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-cpu AS runtime-vulkan
RUN apt-get update && apt-get install -y --no-install-recommends libvulkan1 mesa-vulkan-drivers \
    && rm -rf /var/lib/apt/lists/*

FROM docker.io/nvidia/cuda:12.8.1-runtime-ubuntu24.04@sha256:ebef3c171eeef0298e4eb2e4be843105edf3b8b0ac45e0b43acee358e8046867 AS runtime-cuda
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libssl3 \
    && rm -rf /var/lib/apt/lists/*

# ROCm's libraries (rocBLAS, hipBLAS) are its builder's, as llama.cpp's own
# ROCm image runs on
FROM builder-rocm AS runtime-rocm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libssl3 \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-${BACKEND} AS image
COPY --from=build /out/decision-runtime /decision-runtime
COPY --from=serve /src/decide/decide /decision-runtime/voice-decide
ENTRYPOINT ["/decision-runtime/voice-decide"]
