#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
trap 'echo "終了しました。このウィンドウを閉じてください。"; read -r -p "Enterで閉じる: " _unused' EXIT
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != x86_64 ]]; then
  echo 'この配布物はIntel Mac向けです。'; exit 1
fi
mkdir -p .tools
if [[ ! -x .tools/uv ]]; then
  curl --fail --location --retry 2 --proto '=https' 'https://github.com/astral-sh/uv/releases/download/0.9.7/uv-x86_64-apple-darwin.tar.gz' -o .tools/uv.tar.gz
  printf '%s\n' '41946d87e1576c297d6d3cca88b089b6942b8777a5a25e70de1ef8c57b94b9cf  .tools/uv.tar.gz' | shasum -a 256 -c -
  tar -xzf .tools/uv.tar.gz -C .tools uv-x86_64-apple-darwin/uv
  mv .tools/uv-x86_64-apple-darwin/uv .tools/uv
  chmod +x .tools/uv
fi
export UV_PYTHON_INSTALL_DIR="$PWD/.python"
export UV_CACHE_DIR="$PWD/.cache"
export UV_PYTHON_PREFERENCE=only-managed
.tools/uv venv --python 3.11 .venv
.tools/uv pip install --python .venv/bin/python --only-binary :all: -r requirements.txt
.venv/bin/python transcribe.py --setup
