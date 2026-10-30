#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bin=$(mktemp /tmp/c3-protocol.XXXXXX)
trap 'rm -f "$bin"' EXIT
${CC:-cc} -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined -I components/handshake/include tests/protocol.c components/handshake/handshake.c -o "$bin"
ASAN_OPTIONS=detect_leaks=0 "$bin"
