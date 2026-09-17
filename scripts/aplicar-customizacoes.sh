#!/usr/bin/env bash
# scripts/aplicar-customizacoes.sh
# Reaplica o patch de modelo customizado OpenRouter e reconstrói o container app.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET_VERSION="${1:-v1.30.0}"
PATCH_FILE="$ROOT_DIR/patches/custom-openrouter-model.patch"

echo "=== [Deskcomm Custom] Iniciando sincronização e customizações para $TARGET_VERSION ==="

# 1. Garantir que estamos na versão oficial correta
echo "→ Verificando versão git atual..."
git fetch --all --tags --prune --quiet 2>/dev/null || true

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [[ "$CURRENT_BRANCH" == custom/* ]]; then
  echo "→ Mantendo branch customizada ativa: $CURRENT_BRANCH"
else
  CURRENT_REF="$(git describe --tags --exact-match HEAD 2>/dev/null || git rev-parse --short HEAD)"
  if [ "$CURRENT_REF" != "$TARGET_VERSION" ]; then
    echo "→ Ajustando repositório para a versão oficial $TARGET_VERSION..."
    git checkout -- . || true
    git checkout "$TARGET_VERSION"
    echo "✓ Checkout da versão $TARGET_VERSION concluído."
  fi
fi

# 2. Aplicar patch customizado
echo "→ Verificando patch custom-openrouter-model..."
if [ -f "$PATCH_FILE" ]; then
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

# 3. Atualizar schema do banco de dados (baseline + migração customizada 0263)
if [ -f "hostgator-setup-kit/_common.sh" ] && [ -f ".env" ]; then
  echo "→ Sincronizando schema do banco de dados..."
  source "hostgator-setup-kit/_common.sh"
  load_env ".env"
  DB_URL="$(url_do_schema 2>/dev/null || echo "")"
  if [ -n "$DB_URL" ] && [ -f "supabase/baseline.sql" ]; then
    echo "→ Aplicando supabase/baseline.sql na base de dados..."
    docker run --rm -i -v "$ROOT_DIR/supabase/baseline.sql:/b.sql:ro" postgres:17-alpine psql "$DB_URL" -f /b.sql >/dev/null 2>&1 || true
    if [ -f "supabase/migrations/20260916230000_0263_openrouter_custom_models_publish.sql" ]; then
      echo "→ Aplicando migration 0263_openrouter_custom_models_publish..."
      docker run --rm -i -v "$ROOT_DIR/supabase/migrations/20260916230000_0263_openrouter_custom_models_publish.sql:/m.sql:ro" postgres:17-alpine psql "$DB_URL" -f /m.sql >/dev/null 2>&1 || true
    fi
    echo "✓ Banco de dados atualizado com sucesso."
  fi
fi

# 4. Assegurar que .env e .env.local usem imagens customizadas do app e worker
for ENV_FILE in .env .env.local; do
  if [ -f "$ENV_FILE" ]; then
    echo "→ Configurando $ENV_FILE para imagens customizadas (app e worker)..."
    sed -i 's|^APP_IMAGE=.*|APP_IMAGE=deskcomm-app:custom|' "$ENV_FILE"
    sed -i 's|^APP_PULL_POLICY=.*|APP_PULL_POLICY=never|' "$ENV_FILE"
    sed -i 's|^WORKER_IMAGE=.*|WORKER_IMAGE=deskcomm-worker:custom|' "$ENV_FILE"
    sed -i 's|^WORKER_PULL_POLICY=.*|WORKER_PULL_POLICY=never|' "$ENV_FILE"
    sed -i 's|^SCHEDULER_IMAGE=.*|SCHEDULER_IMAGE=ghcr.io/melgarafael/deskcomm-scheduler:1.30.0|' "$ENV_FILE"
  fi
done

# 5. Reconstruir imagens customizadas e atualizar contêineres
echo "→ Puxando scheduler oficial 1.30.0..."
docker compose pull scheduler 2>/dev/null || true

echo "→ Reconstruindo imagens Docker deskcomm-app:custom e deskcomm-worker:custom..."
COMPOSE_ARGS=(-f docker-compose.prod.yml)
[ -f docker-compose.nginx.yml ] && COMPOSE_ARGS+=(-f docker-compose.nginx.yml)
[ -f docker-compose.build.yml ] && COMPOSE_ARGS+=(-f docker-compose.build.yml)

docker compose "${COMPOSE_ARGS[@]}" build app worker

echo "→ Reiniciando serviços (app, worker, scheduler)..."
docker compose up -d app worker scheduler

echo "=== [Deskcomm Custom] Concluído com sucesso! App e Worker atualizados com correções de agenda e OpenRouter. ==="
