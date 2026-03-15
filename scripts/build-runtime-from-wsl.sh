#!/usr/bin/env bash
set -euo pipefail

REPO_WSL="${1:-$PWD}"
REPO_NAME="$(basename "$REPO_WSL")"
WIN_BUILD_ROOT="/mnt/c/Temp/${REPO_NAME}-winbuild"
WIN_BUILD_ROOT_WIN="$(wslpath -w "$WIN_BUILD_ROOT")"

echo "Preparing Windows build dir: $WIN_BUILD_ROOT"
rm -rf "$WIN_BUILD_ROOT"
mkdir -p "$WIN_BUILD_ROOT"

rsync -a \
  --delete \
  --exclude node_modules \
  --exclude runtime/dist \
  --exclude .git \
  "$REPO_WSL"/ "$WIN_BUILD_ROOT"/

echo "Running Windows install + runtime build"
WIN_BUILD_ROOT_WIN_ESCAPED="${WIN_BUILD_ROOT_WIN//\'/\'\'}"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
  \$ErrorActionPreference = 'Stop'
  Set-Location '$WIN_BUILD_ROOT_WIN_ESCAPED'
  npm.cmd ci
  npm.cmd run runtime:build:exe
"

echo "Copying runtime/dist back to repo"
mkdir -p "$REPO_WSL/runtime"
rsync -a --delete "$WIN_BUILD_ROOT/runtime/dist/" "$REPO_WSL/runtime/dist/"

echo
echo "Built artifacts:"
find "$REPO_WSL/runtime/dist" -maxdepth 1 -type f | sort
