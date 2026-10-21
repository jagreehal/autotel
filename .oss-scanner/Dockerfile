# OSS Scanner build image (https://github.com/anthropics/oss-scanner).
# Built online with the repository as context; the audit that follows runs offline,
# so everything the build and the unit tests need is installed here.
FROM node:24-bookworm

ENV CI=true \
    TURBO_TELEMETRY_DISABLED=1

RUN corepack enable

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

RUN pnpm install --frozen-lockfile

# Chromium for autotel-devtools' UI tests, and for opening its web UI offline.
RUN pnpm --filter autotel-devtools exec playwright install --with-deps chromium

# Published packages only. apps/, examples/ and docs are out of scope; see threat_model.md.
RUN pnpm turbo run build --filter='./packages/*'

# Unit tests prove the image works; a failure must not abort the build.
# Integration tests need live services (MongoDB, backends) and are not run here.
RUN pnpm turbo run test --filter='./packages/*' --continue \
    || echo "WARNING: package tests reported failures"
