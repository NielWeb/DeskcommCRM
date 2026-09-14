/**
 * GET /api/v1/ai/knowledge/chave — a base de conhecimento consegue indexar?
 *
 * Existe porque a tela de conhecimento prometia "a indexação começa em
 * instantes" sem nunca perguntar se havia chave para isso. Numa instalação sem
 * `OPENAI_API_KEY` — que é o estado de TODO primeiro deploy, já que o campo do
 * instalador é opcional e pulável com Enter — o material subia, a fonte nascia
 * `ready`, e nada acontecia nunca. Nenhuma das rotas de conhecimento chamava
 * uma linha de verificação de chave.
 *
 * A resposta diz três coisas, e as três são acionáveis na tela:
 *   * se dá para indexar agora;
 *   * de ONDE a chave sai (a pessoa precisa saber qual está valendo);
 *   * quais chaves OpenAI a organização já tem, para escolher em vez de digitar
 *     outra.
 *
 * Nunca devolve material de credencial: só rótulo e os quatro últimos dígitos,
 * que é o que a view `ai_provider_credentials_safe` expõe.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EXPLICACAO_DA_ORIGEM,
  resolverChaveDeEmbedding,
} from "@/lib/ai/embeddings/chave";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const chave = await resolverChaveDeEmbedding(activeOrg.orgId);

  const supabase = await createClient();
  const { data: credenciais } = await supabase
    .from("ai_provider_credentials_safe")
    .select("id, label, provider, api_key_last4, validated_at, validation_error, is_active")
    .eq("organization_id", activeOrg.orgId)
    .in("provider", ["openai", "openrouter"])
    .order("created_at", { ascending: true });

  const disponiveis = (credenciais ?? []) as Array<{
    id: string;
    label: string;
    provider: string;
    api_key_last4: string | null;
    validated_at: string | null;
    validation_error: string | null;
    is_active: boolean;
  }>;

  return ok(
    {
      pode_indexar: chave !== null,
      origem: chave?.origem ?? null,
      explicacao: chave ? EXPLICACAO_DA_ORIGEM[chave.origem] : null,
      chave_em_uso: chave?.rotulo ?? null,
      provider_em_uso: chave?.provider ?? null,
      avisos: chave?.avisos ?? [],
      credenciais_openai: disponiveis.filter((c) => c.provider === "openai"),
      credenciais_disponiveis: disponiveis,
    },
    { requestId },
  );
}

const vincularChaveSchema = z.object({
  credential_id: z.string().uuid().nullable(),
});

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg, user } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_json", t("Corpo da requisição inválido."), 400, { requestId });
  }

  const parsed = vincularChaveSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { credential_id } = parsed.data;
  const admin = createAdminClient();

  if (credential_id) {
    const { data: cred } = await admin
      .from("ai_provider_credentials")
      .select("id, label, provider, is_active, validated_at")
      .eq("id", credential_id)
      .eq("organization_id", activeOrg.orgId)
      .eq("is_active", true)
      .not("validated_at", "is", null)
      .maybeSingle();

    if (!cred || (cred.provider !== "openai" && cred.provider !== "openrouter")) {
      return fail(
        "credencial_invalida",
        t("A chave escolhida não foi encontrada ou não pertence a um provedor suportado (OpenAI ou OpenRouter)."),
        400,
        { requestId },
      );
    }

    const provider = cred.provider;
    const modelId = provider === "openrouter" ? "openai/text-embedding-3-small" : "text-embedding-3-small";
    const baseUrl = provider === "openrouter" ? "https://openrouter.ai/api/v1" : null;

    const payload = [
      {
        organization_id: activeOrg.orgId,
        purpose: "embedding_indexar",
        provider,
        credential_id: cred.id,
        model_id: modelId,
        base_url: baseUrl,
        is_enabled: true,
        updated_at: new Date().toISOString(),
      },
      {
        organization_id: activeOrg.orgId,
        purpose: "embedding_consultar",
        provider,
        credential_id: cred.id,
        model_id: modelId,
        base_url: baseUrl,
        is_enabled: true,
        updated_at: new Date().toISOString(),
      },
    ];

    const { error: upsertErr } = await admin
      .from("ai_purpose_bindings")
      .upsert(payload, { onConflict: "organization_id,purpose" });

    if (upsertErr) {
      return fail("db_error", upsertErr.message, 500, { requestId });
    }

    void audit({
      action: "ai.purpose_binding_updated",
      organizationId: activeOrg.orgId,
      actorUserId: user.id,
      resourceType: "ai_purpose_binding",
      resourceId: cred.id,
      metadata: { label: cred.label, provider: cred.provider },
    });
  } else {
    // Remover bindings manuais para voltar ao comportamento automático
    await admin
      .from("ai_purpose_bindings")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .in("purpose", ["embedding_indexar", "embedding_consultar"]);

    void audit({
      action: "ai.purpose_binding_updated",
      organizationId: activeOrg.orgId,
      actorUserId: user.id,
      resourceType: "ai_purpose_binding",
      resourceId: activeOrg.orgId,
      metadata: { action: "unbound" },
    });
  }

  const novaChave = await resolverChaveDeEmbedding(activeOrg.orgId);

  return ok(
    {
      pode_indexar: novaChave !== null,
      origem: novaChave?.origem ?? null,
      explicacao: novaChave ? EXPLICACAO_DA_ORIGEM[novaChave.origem] : null,
      chave_em_uso: novaChave?.rotulo ?? null,
      provider_em_uso: novaChave?.provider ?? null,
      avisos: novaChave?.avisos ?? [],
    },
    { requestId },
  );
}
