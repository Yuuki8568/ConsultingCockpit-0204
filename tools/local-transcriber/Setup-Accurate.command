#!/bin/bash
set -euo pipefail
# Compatibility entry point: Setup now prepares only the accurate model.
exec "$(dirname -- "$0")/Setup.command"
