#!/bin/sh
set -e

# docker-entrypoint.sh
# Minimal, unprivileged entrypoint forwarding signals to the application process.

exec "$@"
