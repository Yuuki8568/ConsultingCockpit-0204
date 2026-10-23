#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [[ ! -x .venv/bin/python ]]; then echo '先にSetup.commandを実行してください。'; read -r -p 'Enterで閉じる: ' _unused; exit 1; fi
export HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1
caffeinate -i .venv/bin/python bridge.py
