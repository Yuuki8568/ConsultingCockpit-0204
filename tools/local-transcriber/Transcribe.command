#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
trap 'read -r -p "Enterで閉じる: " _unused' EXIT
if [[ ! -x .venv/bin/python ]]; then echo '先にSetup.commandで初回準備をしてください。'; exit 1; fi
SOURCE_FILE=$(osascript -e 'POSIX path of (choose file with prompt "文字起こしする録音・録画を選択")') || exit 0
OUTPUT_FOLDER=$(osascript -e 'POSIX path of (choose folder with prompt "文字起こしの保存先（平文で保存）")') || exit 0
TERMS=$(osascript -e 'text returned of (display dialog "人名・社名・専門用語をスペースで区切って入力（任意）" default answer "" buttons {"キャンセル", "開始"} default button "開始")') || exit 0
export HF_HUB_OFFLINE=1
export HF_HUB_DISABLE_TELEMETRY=1
caffeinate -i .venv/bin/python transcribe.py --input "$SOURCE_FILE" --output "$OUTPUT_FOLDER" --terms "$TERMS"

