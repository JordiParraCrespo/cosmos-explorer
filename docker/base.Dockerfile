# syntax=docker/dockerfile:1
FROM node:20.9.0 AS base
ARG PNPM_VERSION=9.7.0
ARG TURBO_TEAM=peersyst
ENV TURBO_TEAM=$TURBO_TEAM
WORKDIR /project
RUN npm install -g pnpm@${PNPM_VERSION}

# Install Go. Keep GO_VERSION equal to the toolchain line in go.work.
ARG GO_VERSION=1.26.11
RUN apt-get update && apt-get install -y wget && \
    wget https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz && \
    rm go${GO_VERSION}.linux-amd64.tar.gz && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Add Go to PATH
ENV PATH="/usr/local/go/bin:${PATH}"

# Add project files
COPY . /project
# Install package and app dependencies
RUN --mount=type=secret,id=turbo_token,env=TURBO_TOKEN pnpm install
# Lint packages
# RUN --mount=type=secret,id=turbo_token,env=TURBO_TOKEN pnpm run lint:packages
# Typecheck packages
# RUN --mount=type=secret,id=turbo_token,env=TURBO_TOKEN pnpm run typecheck:packages
# Build packages
# RUN --mount=type=secret,id=turbo_token,env=TURBO_TOKEN pnpm run build:packages
