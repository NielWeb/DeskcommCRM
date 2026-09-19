#!/usr/bin/env bash
# atualizar.sh — Atualização segura que preserva customizações locais
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TARGET_VERSION="${1:-v1.38.0}"

echo "=== [Deskcomm] Iniciando atualização para $TARGET_VERSION mantendo customizações ==="

# 1. Guarda alterações temporárias se houver
HAS_DIFF=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "→ Salvando estado das alterações locais no stash..."
  git stash push -m "custom-before-update" || true
  HAS_DIFF=1
fi

# 2. Puxa atualizações oficiais
echo "→ Puxando atualizações do GitHub..."
git fetch --all --tags --prune
if git rev-parse --verify "refs/tags/$TARGET_VERSION" >/dev/null 2>&1; then
  echo "→ Fazendo checkout da tag oficial $TARGET_VERSION..."
  git checkout "$TARGET_VERSION"
else
  echo "→ Puxando $TARGET_VERSION..."
  git pull origin "$TARGET_VERSION" || true
fi

# 3. Executa aplicação das customizações e rebuild
echo "→ Reaplicando customizações e reconstruindo o app..."
bash "$ROOT_DIR/scripts/aplicar-customizacoes.sh"

echo "=== [Deskcomm] Atualização finalizada com sucesso na versão $TARGET_VERSION! ==="
