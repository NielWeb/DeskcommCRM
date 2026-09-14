"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * A CHAVE QUE FAZ O MATERIAL VIRAR CONHECIMENTO — dita na tela, resolvida ali.
 *
 * Preparar um material para o agente encontrá-lo exige uma chave da OpenAI. Isso
 * era verdade e não estava escrito em lugar nenhum do caminho: a tela de
 * conhecimento prometia "a indexação começa em instantes", o material subia, e
 * numa instalação sem chave nada acontecia — para sempre, sem erro, sem estado,
 * sem aviso.
 *
 * Duas decisões de UX aqui, e as duas são sobre não criar becos:
 *
 *  1. **O aviso vem ANTES do cadastro**, não depois da falha. Descobrir que
 *     faltava chave DEPOIS de subir um PDF de 8 MB é a pior ordem possível.
 *  2. **Dá para resolver sem sair da tela.** O precedente é o passo "o cérebro
 *     dele" do onboarding, que cola a chave dentro do passo que precisa dela.
 *     Mandar a pessoa para outra aba, cadastrar, e voltar é onde se perde gente.
 *
 * Quando JÁ existe chave, o componente não some: ele diz qual está valendo. Sem
 * isso, "por que ele indexou com a chave errada?" não tem resposta na tela.
 */
import { useState } from "react";
import Link from "next/link";
import { KeyRound, CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface CredencialItem {
  id: string;
  label: string;
  provider?: string;
  api_key_last4: string | null;
  validated_at: string | null;
  validation_error: string | null;
  is_active: boolean;
}

export interface EstadoDaChave {
  pode_indexar: boolean;
  origem: string | null;
  explicacao: string | null;
  chave_em_uso: string | null;
  provider_em_uso?: string | null;
  avisos: string[];
  credenciais_openai: CredencialItem[];
  credenciais_disponiveis?: CredencialItem[];
}

interface Props {
  estado: EstadoDaChave;
  /** Chamado depois de cadastrar uma chave, para a tela recarregar o estado. */
  onChaveCadastrada: () => void;
}

export function ChaveDeConhecimento({ estado, onChaveCadastrada }: Props) {
  const t = useT();
  const [abrindo, setAbrindo] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [providerEscolhido, setProviderEscolhido] = useState<"openai" | "openrouter">("openai");
  const [rotulo, setRotulo] = useState(t("Chave da OpenAI"));
  const [chave, setChave] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [vinculando, setVinculando] = useState(false);

  const credenciais = estado.credenciais_disponiveis && estado.credenciais_disponiveis.length > 0
    ? estado.credenciais_disponiveis
    : estado.credenciais_openai;

  async function vincular(credentialId: string | null) {
    setVinculando(true);
    try {
      await apiClient.put("/api/v1/ai/knowledge/chave", {
        credential_id: credentialId,
      });
      toast.success(t("Chave atualizada com sucesso."));
      setTrocando(false);
      onChaveCadastrada();
    } catch (err) {
      showApiError(err);
    } finally {
      setVinculando(false);
    }
  }

  async function cadastrar() {
    if (chave.trim().length < 8) {
      toast.error(t("Cole a chave inteira antes de salvar."));
      return;
    }
    setEnviando(true);
    try {
      const res = await apiClient.post<{ id: string }>("/api/v1/ai/credentials", {
        provider: providerEscolhido,
        label: rotulo.trim() || (providerEscolhido === "openrouter" ? t("Chave do OpenRouter") : t("Chave da OpenAI")),
        api_key: chave.trim(),
      });
      toast.success(
        providerEscolhido === "openrouter"
          ? t("Chave salva. Estamos conferindo com o OpenRouter — leva alguns segundos.")
          : t("Chave salva. Estamos conferindo com a OpenAI — leva alguns segundos.")
      );
      if (res?.id) {
        // Auto-vincular a nova chave para o acervo
        try {
          await apiClient.put("/api/v1/ai/knowledge/chave", { credential_id: res.id });
        } catch {
          // ignora se a validação assíncrona ainda estiver ocorrendo
        }
      }
      setChave("");
      setAbrindo(false);
      onChaveCadastrada();
    } catch (err) {
      showApiError(err);
    } finally {
      setEnviando(false);
    }
  }

  // A chave existe e ainda não serve: a validação com o provedor está em curso.
  const conferindo =
    !estado.pode_indexar &&
    credenciais.some((c) => c.is_active && !c.validated_at && !c.validation_error);

  if (conferindo) {
    return (
      <div
        data-testid="conhecimento-chave-conferindo"
        className="flex items-center gap-2 text-xs text-text-muted"
      >
        <KeyRound className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        <span>{t("Conferindo a chave com o provedor — leva alguns segundos.")}</span>
      </div>
    );
  }

  if (estado.pode_indexar) {
    return (
      <div className="space-y-2">
        <div
          data-testid="conhecimento-chave-ok"
          className="flex flex-wrap items-center gap-2 text-xs text-text-muted"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-success-fg" aria-hidden />
          <span>
            {t("Pronto para preparar material.")}{" "}
            {estado.chave_em_uso ? (
              <>
                {t("Usando a chave")}{" "}
                <span className="font-medium text-foreground">{estado.chave_em_uso}</span>
                {estado.provider_em_uso && (
                  <span className="ml-1 text-[10px] uppercase font-mono px-1 py-0.5 rounded bg-muted/70 text-text-muted">
                    {estado.provider_em_uso}
                  </span>
                )}
                .
              </>
            ) : (
              estado.explicacao ? t(estado.explicacao) : null
            )}
          </span>

          {credenciais.length > 1 && !trocando && (
            <button
              type="button"
              onClick={() => setTrocando(true)}
              className="ml-2 font-medium text-primary hover:underline"
            >
              {t("Trocar chave vinculada")}
            </button>
          )}

          {estado.avisos.map((a) => (
            <span key={a} className="w-full text-warning-fg">
              {t(a)}
            </span>
          ))}
        </div>

        {trocando && (
          <div className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-muted/40 border text-xs">
            <span className="font-medium text-foreground">{t("Vincular chave para acervo:")}</span>
            <select
              disabled={vinculando}
              className="px-2 py-1 border rounded bg-background text-foreground text-xs"
              value={credenciais.find((c) => c.label === estado.chave_em_uso)?.id ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val) void vincular(val);
              }}
            >
              <option value="" disabled>{t("Escolha uma chave cadastrada...")}</option>
              {credenciais.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.provider ?? "openai"}) {c.api_key_last4 ? `•••• ${c.api_key_last4}` : ""}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTrocando(false)}
              disabled={vinculando}
              className="h-7 px-2 text-xs"
            >
              {t("Cancelar")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      data-testid="conhecimento-sem-chave"
      className="space-y-3 border-warning-bg bg-warning-bg/20 p-4"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {t("Falta uma chave da OpenAI para o agente aprender o seu material")}
          </h3>
          <p className="text-xs text-text-muted">
            {t(
              "Preparar um documento para o agente encontrá-lo usa OpenAI ou OpenRouter (com text-embedding-3-small). Sem ela o material fica esperando e o agente não consegue consultá-lo.",
            )}
          </p>
        </div>
      </div>

      {abrindo ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("Provedor da chave")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={providerEscolhido === "openai" ? "default" : "outline"}
                onClick={() => {
                  setProviderEscolhido("openai");
                  setRotulo(t("Chave da OpenAI"));
                }}
              >
                OpenAI
              </Button>
              <Button
                type="button"
                size="sm"
                variant={providerEscolhido === "openrouter" ? "default" : "outline"}
                onClick={() => {
                  setProviderEscolhido("openrouter");
                  setRotulo(t("Chave do OpenRouter"));
                }}
              >
                OpenRouter
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="chave-rotulo">{t("Como você quer chamar esta chave")}</Label>
            <Input
              id="chave-rotulo"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              disabled={enviando}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="chave-valor">
              {providerEscolhido === "openrouter" ? t("Chave do OpenRouter") : t("Chave da OpenAI")}
            </Label>
            <Input
              id="chave-valor"
              data-testid="conhecimento-chave-input"
              type="password"
              placeholder={providerEscolhido === "openrouter" ? "sk-or-v1-…" : "sk-…"}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              disabled={enviando}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              {t("Você pega em")}{" "}
              <a
                href={providerEscolhido === "openrouter" ? "https://openrouter.ai/keys" : "https://platform.openai.com/api-keys"}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-4"
              >
                {providerEscolhido === "openrouter" ? "openrouter.ai/keys" : "platform.openai.com/api-keys"}
              </a>
              . {t("Ela é guardada cifrada e nunca aparece de volta na tela.")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={cadastrar}
              disabled={enviando}
              data-testid="conhecimento-chave-salvar"
            >
              {enviando ? t("Salvando…") : t("Salvar chave")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAbrindo(false)} disabled={enviando}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAbrindo(true)}
            data-testid="conhecimento-cadastrar-chave"
          >
            <KeyRound className="mr-2 h-3.5 w-3.5" aria-hidden />
            {t("Cadastrar a chave aqui")}
          </Button>
          <span className="text-xs text-text-muted">
            {t("ou veja todas em")}{" "}
            <Link
              href="/app/ai/credentials"
              className="font-medium text-foreground underline underline-offset-4"
            >
              {t("IA › Credenciais")}
            </Link>
          </span>
        </div>
      )}
    </Card>
  );
}
