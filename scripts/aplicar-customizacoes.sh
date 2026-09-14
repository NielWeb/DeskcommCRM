#!/usr/bin/env bash
# scripts/aplicar-customizacoes.sh
# Reaplica o patch de modelo customizado OpenRouter e reconstrói o container app.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PATCH_FILE="$ROOT_DIR/patches/custom-openrouter-model.patch"

echo "=== [Deskcomm Custom] Verificando customizações OpenRouter ==="

if [ -f "$PATCH_FILE" ]; then
  # Se o patch já estiver aplicado, não faz nada
  if git apply --check --reverse "$PATCH_FILE" >/dev/null 2>&1; then
    echo "✓ Patch custom-openrouter-model já está aplicado no código."
  else
    echo "→ Aplicando patch custom-openrouter-model..."
    git apply --3way "$PATCH_FILE" 2>/dev/null || git apply "$PATCH_FILE" || {
      echo "⚠ Conflito ao aplicar patch automaticamente. Verifique com git status."
      exit 1
    }
    echo "✓ Patch aplicado com sucesso."
  fi
else
  echo "⚠ Arquivo de patch $PATCH_FILE não encontrado."
fi

# Assegurar que .env e .env.local usem a imagem customizada do app e versão 1.23.0 dos workers
for ENV_FILE in .env .env.local; do
  if [ -f "$ENV_FILE" ]; then
    echo "→ Configurando $ENV_FILE para imagem customizada e workers 1.23.0..."
    sed -i 's|^APP_IMAGE=.*|APP_IMAGE=deskcomm-app:custom|' "$ENV_FILE"
    sed -i 's|^APP_PULL_POLICY=.*|APP_PULL_POLICY=never|' "$ENV_FILE"
    sed -i 's|^WORKER_IMAGE=.*|WORKER_IMAGE=ghcr.io/melgarafael/deskcomm-worker:1.23.0|' "$ENV_FILE"
    sed -i 's|^SCHEDULER_IMAGE=.*|SCHEDULER_IMAGE=ghcr.io/melgarafael/deskcomm-scheduler:1.23.0|' "$ENV_FILE"
  fi
done

# Reconstruir e subir o app com docker compose
echo "→ Reconstruindo imagem Docker deskcomm-app:custom..."
COMPOSE_ARGS=(-f docker-compose.prod.yml)
[ -f docker-compose.nginx.yml ] && COMPOSE_ARGS+=(-f docker-compose.nginx.yml)
[ -f docker-compose.build.yml ] && COMPOSE_ARGS+=(-f docker-compose.build.yml)

docker compose "${COMPOSE_ARGS[@]}" build app
docker compose -f docker-compose.prod.yml -f docker-compose.nginx.yml up -d app

echo "=== [Deskcomm Custom] Concluído com sucesso! App no ar com modelo customizado OpenRouter. ==="
