# Agora plugin builder — the ONE build environment, identical on every OS.
#
# The only thing a teammate needs installed is Docker. No local Go / Node / make,
# no PATH/"Program Files" quirks, no Git-Bash-vs-WSL node_modules mismatch — the
# toolchain lives here and runs the same on Windows, macOS, and Linux.
#
# Built/used automatically by scripts/up.sh (image tag: agora-builder).
FROM golang:1.26-bookworm

# Node 22 (webapp) + make (Mattermost plugin Makefile) + git (manifest version).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends make curl ca-certificates git; \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src/plugin
