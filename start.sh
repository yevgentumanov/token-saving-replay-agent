#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v python3.12 >/dev/null 2>&1; then
  exec python3.12 -u bootstrap.py "$@"
elif command -v python3.11 >/dev/null 2>&1; then
  exec python3.11 -u bootstrap.py "$@"
elif command -v python3.10 >/dev/null 2>&1; then
  exec python3.10 -u bootstrap.py "$@"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 -u bootstrap.py "$@"
else
  echo "Python 3.10+ was not found."
  echo "macOS: install Python from https://www.python.org/downloads/ or run: brew install python"
  echo "Linux: install python3.10+ and python3-venv with your package manager."
  exit 1
fi
