import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { parseFaqMarkdown } from "../lib/ai/rag/ingest/faq";
import { publicarMemoriaDaOrg } from "../lib/ai/memoria-da-org";
import { capacidadesPadraoDoOnboarding } from "../lib/ai/agents/capacidades-padrao";

function carregarEnv(): { url: string; serviceRole: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const arquivos = [".env.local", ".env"];
  for (const arq of arquivos) {
    const caminho = path.join(process.cwd(), arq);
    if (!url || !serviceRole) {
      if (fs.existsSync(caminho)) {
        const conteudo = fs.readFileSync(caminho, "utf8");
        for (const linha of conteudo.split("\n")) {
          const l = linha.trim();
          if (!l || l.startsWith("#")) continue;
          const [chave, ...resto] = l.split("=");
          const valor = resto.join("=").trim().replace(/^["']|["']$/g, "");
          if (chave === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = valor;
          if (chave === "SUPABASE_SERVICE_ROLE_KEY" && !serviceRole) serviceRole = valor;
        }
      }
    }
  }

  if (!url || !serviceRole) {
    throw new Error(
      "Credenciais ausentes! Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local",
    );
  }

  return { url, serviceRole };
}

async function main() {
  const { url, serviceRole } = carregarEnv();
  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Conectado ao Supabase:", url);

  // 1. Localizar Tenant "Gisele Carniel"
  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, display_name, legal_name, slug")
    .eq("slug", "gisele-carniel")
    .limit(1);

  if (orgErr || !orgs || orgs.length === 0) {
    throw new Error(`Tenant 'gisele-carniel' não encontrado: ${orgErr?.message}`);
  }

  const org = orgs[0];
  const orgId = org.id;
  console.log(`Tenant identificado: ${org.display_name} (${orgId})`);

  // Localizar admin da organização
  const { data: userOrgs } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .limit(1);
  const userId = userOrgs?.[0]?.user_id || "00000000-0000-0000-0000-000000000000";

  // Localizar canal WhatsApp
  const { data: channels } = await admin
    .from("channel_sessions")
    .select("id, status")
    .eq("organization_id", orgId)
    .limit(1);
  const channelSessionId = channels?.[0]?.id;
  if (!channelSessionId) {
    throw new Error("Canal de WhatsApp não encontrado para a organização.");
  }

  // Localizar credencial de IA
  const { data: creds } = await admin
    .from("ai_provider_credentials_safe")
    .select("id, provider")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1);
  const credentialId = creds?.[0]?.id ?? null;
  const provider = creds?.[0]?.provider ?? "openrouter";

  // 2. Configurar Funil "Agendamentos" e Etapas
  console.log("Configurando funil 'Agendamentos' e etapas...");
  let pipelineId: string;
  const { data: existingPipe } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", "Agendamentos")
    .maybeSingle();

  if (existingPipe) {
    pipelineId = existingPipe.id;
  } else {
    const { data: newPipe, error: pipeErr } = await admin
      .from("crm_pipelines")
      .insert({
        organization_id: orgId,
        name: "Agendamentos",
        slug: "agendamentos",
        is_default: true,
      })
      .select("id")
      .single();
    if (pipeErr || !newPipe) throw new Error(`Erro ao criar funil: ${pipeErr?.message}`);
    pipelineId = newPipe.id;
  }

  const etapas = [
    { nome: "Novo contato", slug: "novo_contato", position: 1000, is_won: false, is_lost: false, agent_stage_hint: "new" },
    { nome: "Já acolhido", slug: "ja_acolhido", position: 2000, is_won: false, is_lost: false, agent_stage_hint: "contacted" },
    { nome: "Entendendo a procura", slug: "entendendo_a_procura", position: 3000, is_won: false, is_lost: false, agent_stage_hint: "qualifying" },
    { nome: "Interesse em agendar", slug: "interesse_em_agendar", position: 4000, is_won: false, is_lost: false, agent_stage_hint: "qualified" },
    { nome: "Definindo horário e dados", slug: "definindo_horario_e_dados", position: 5000, is_won: false, is_lost: false, agent_stage_hint: "negotiating" },
    { nome: "Consulta marcada", slug: "consulta_marcada", position: 6000, is_won: true, is_lost: false, agent_stage_hint: "won" },
    { nome: "Não agendou", slug: "nao_agendou", position: 7000, is_won: false, is_lost: true, agent_stage_hint: "lost" },
  ];

  // Limpar etapas antigas não mapeadas ou atualizar
  for (const e of etapas) {
    const { data: existingStage } = await admin
      .from("crm_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("position", e.position)
      .maybeSingle();

    if (existingStage) {
      await admin
        .from("crm_stages")
        .update({
          name: e.nome,
          slug: e.slug,
          is_won: e.is_won,
          is_lost: e.is_lost,
          agent_stage_hint: e.agent_stage_hint,
          is_archived: false,
        })
        .eq("id", existingStage.id);
    } else {
      await admin.from("crm_stages").insert({
        pipeline_id: pipelineId,
        organization_id: orgId,
        name: e.nome,
        slug: e.slug,
        position: e.position,
        is_won: e.is_won,
        is_lost: e.is_lost,
        agent_stage_hint: e.agent_stage_hint,
      });
    }
  }

  // 3. Publicar Memória da Organização (Regras da Casa)
  console.log("Publicando regras na memória da organização...");
  const memoriaTexto = `Clínica InterLuz — Psicologia e Psiquiatria
Responsável técnica: Gisele Carniel (CRP 06/160907)
Endereço: Rua José Bianchi, 555, sala 915, Ribeirão Preto/SP
WhatsApp oficial: (16) 99293-2930
Instagram: @clinicainterluz
Atendimento: On-line e presencial

Regras Institucionais e Éticas:
1. Nunca realizar diagnósticos ou interpretar sintomas por mensagens.
2. Nunca indicar, ajustar ou suspender medicamentos psiquiátricos.
3. Nunca prometer cura, melhora rápida ou prazos de recuperação.
4. Nunca afirmar que avaliações confirmam automaticamente TDAH, autismo ou transtornos.
5. Nunca garantir reembolso de convênios.
6. Em qualquer menção a risco de vida, automutilação ou ideação suicida, fornecer acolhimento, números de emergência (SAMU 192 e CVV 188) e acionar equipe humana imediatamente.
7. Convênios: condição especial de R$ 150 sujeita à confirmação prévia da equipe para operadora e serviço.`;

  const pubMem = await publicarMemoriaDaOrg(admin, orgId, userId, memoriaTexto);
  if (!pubMem.ok) {
    console.warn("Aviso ao publicar memória:", pubMem.mensagem);
  }

  // 4. Cadastrar FAQ na Base de Conhecimento
  console.log("Cadastrando base de conhecimento FAQ...");
  const pacotePath = path.join(process.cwd(), "pacote-gisele-carniel.md");
  const pacoteConteudo = fs.readFileSync(pacotePath, "utf8");
  const faqBloco = pacoteConteudo.split("```markdown")[1]?.split("```")[0] || "";
  const faqItems = parseFaqMarkdown(faqBloco);

  let ksId: string;
  const { data: existingKs } = await admin
    .from("ai_knowledge_sources")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", "FAQ Clínica InterLuz")
    .maybeSingle();

  if (existingKs) {
    ksId = existingKs.id;
    await admin.from("ai_faq_items").delete().eq("knowledge_source_id", ksId);
  } else {
    const { data: newKs, error: ksErr } = await admin
      .from("ai_knowledge_sources")
      .insert({
        organization_id: orgId,
        source_type: "faq",
        name: "FAQ Clínica InterLuz",
        status: "ready",
        is_active: true,
        ingested_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ksErr || !newKs) throw new Error(`Erro ao criar knowledge source: ${ksErr?.message}`);
    ksId = newKs.id;
  }

  if (faqItems.length > 0) {
    const rows = faqItems.map((item, idx) => ({
      organization_id: orgId,
      knowledge_source_id: ksId,
      question: item.question,
      answer: item.answer,
      tags: item.tags,
      locale: item.locale,
      position: idx,
    }));
    await admin.from("ai_faq_items").insert(rows);

    await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: ksId,
      p_payload: { knowledge_source_id: ksId, source_type: "faq" },
      p_organization_id: orgId,
    } as never);
  }

  // 5. Configurar Agente de IA e Versão
  console.log("Atualizando Agente de IA e criando versão...");
  const promptAgente = `# Quem você é
Você atende os pacientes da Clínica InterLuz, clínica de Psicologia e Psiquiatria localizada em Ribeirão Preto/SP (Responsável técnica: Gisele Carniel, CRP 06/160907).
Apresente-se sempre como assistente virtual da Clínica InterLuz. Nunca finja ser a psicóloga Gisele Carniel.
Tom de voz: humano, leve, acolhedor, calmo, respeitoso e profissional. Sem termos clínicos complexos.

# Triagem Inicial e Fluidez
1. Dê as boas-vindas acolhedoras e identifique o serviço procurado (Psicologia, Terapia de Casal, Psiquiatria ou Avaliação Neuropsicológica).
2. Se a pessoa já disser o serviço procurado (ex: "Avaliação", "Psicologia"), NÃO pergunte de novo qual serviço ela quer. Apenas acolha e pergunte se é para ela mesma e se prefere presencial ou on-line.
3. Não faça perguntas redundantes de coisas que o paciente já respondeu. Máximo de uma pergunta por mensagem e máximo de um emoji por mensagem.

# Regras Rígidas de Agendamento Autônomo (Obrigatório e sem humanos)
Você tem ferramentas ativas para consultar horários livres e marcar consultas em tempo real. Você NUNCA transfere para a equipe agendar, e NUNCA diz que "vai verificar e retornar depois".

1. **Quando o paciente perguntar sobre horários ou mencionar um dia** (ex.: "tem horário para sexta?", "quais os horários?", "tem vaga amanhã?"):
   - PARE de fazer perguntas de triagem.
   - CHAME IMEDIATAMENTE a ferramenta crm_find_free_slots com event_type_slug: "consulta" e dia: "YYYY-MM-DD" (ou dias_a_frente: 7).
   - Apresente de 2 a 3 horários livres que a ferramenta retornou (ex.: "Para sexta-feira (18/09), temos disponíveis às 09:00, 10:00 e 14:00. Qual horário fica melhor para você?").
   - Se o paciente já indicou um turno (ex.: "prefiro de manhã"), apresente as opções de horários livres da manhã.

2. **Quando o paciente escolher ou solicitar um horário específico** (ex.: "consigo às 9", "pode ser às 17h", "às 10h"):
   - Se você ainda não chamou crm_find_free_slots para essa data neste turno, chame primeiro.
   - Com o horário livre na lista retornada, CHAME IMEDIATAMENTE crm_book_appointment usando o starts_at retornado e o contact_id do paciente NESTE MESMO TURNO!
   - Com a confirmação da ferramenta, responda confirmando o agendamento no ato: informe o serviço, modalidade, data e horário confirmado, e instruções de atendimento.
   - É TERMINANTEMENTE PROIBIDO responder "vou verificar a disponibilidade e já retorno" ou prometer checagens futuras. Você conclui o agendamento agora.

3. **Se o horário pedido estiver ocupado**:
   - Avise com educação que aquele horário específico não está vago e apresente de 2 a 3 horários livres mais próximos retornados por crm_find_free_slots.

# Valores e Dúvidas
- Consulte a base de conhecimento e informe sempre os valores diretamente, com clareza.
- Objeção de preço ou "vou pensar": acolha com empatia e apresente as formas de pagamento (cartão parcelado, PIX com 5% de desconto à vista).

# Limites clínicos e éticos
- Nunca realize diagnóstico ou interprete sintomas como confirmação de transtornos.
- Nunca recomende, altere ou sugira suspensão de medicamentos psiquiátricos.
- Nunca prometa cura, melhora garantida ou prazo de recuperação.
- Nunca afirme que avaliação confirma automaticamente TDAH ou autismo.
- Não peça documentos, laudos ou fotos de documentos pelo WhatsApp.

# Encaminhamento imediato para equipe humana
Transfira para atendimento humano SOMENTE nos seguintes casos:
- Menção a risco de vida, ideação suicida ou crise: acolha, forneça o SAMU 192 e CVV 188, interrompa a venda e chame a equipe imediatamente.
- Solicitação de diagnóstico, laudos médicos ou dúvidas sobre medicamentos.
- Pedido expresso para falar com Gisele Carniel ou outro profissional humano.`;

  // Localizar agente existente do onboarding
  const { data: existingAgent } = await admin
    .from("ai_agents")
    .select("id")
    .eq("organization_id", orgId)
    .maybeSingle();

  let agentId: string;
  if (existingAgent) {
    agentId = existingAgent.id;
    await admin
      .from("ai_agents")
      .update({
        name: "Atendente Virtual Clínica InterLuz",
        description: "Acolhimento, triagem e esclarecimento de serviços da Clínica InterLuz.",
        system_prompt: promptAgente,
        is_active: true,
        model: "openrouter/anthropic/claude-3.5-sonnet",
      })
      .eq("id", agentId);
  } else {
    const { data: newAgent, error: agErr } = await admin
      .from("ai_agents")
      .insert({
        organization_id: orgId,
        name: "Atendente Virtual Clínica InterLuz",
        description: "Acolhimento, triagem e esclarecimento de serviços da Clínica InterLuz.",
        model: "openrouter/anthropic/claude-3.5-sonnet",
        system_prompt: promptAgente,
        is_active: true,
        is_default: true,
        kind: "mcp_agent",
        created_by: userId,
      })
      .select("id")
      .single();
    if (agErr || !newAgent) throw new Error(`Erro ao criar agente: ${agErr?.message}`);
    agentId = newAgent.id;
  }

  // Obter tool_ids para pacote "vender"
  const toolIds = capacidadesPadraoDoOnboarding();

  // Criar ou atualizar Versão 1
  const { data: existingVer } = await admin
    .from("ai_agent_versions")
    .select("id")
    .eq("agent_id", agentId)
    .eq("version_number", 1)
    .maybeSingle();

  let versionId: string;
  if (existingVer) {
    versionId = existingVer.id;
    await admin
      .from("ai_agent_versions")
      .update({
        system_prompt: promptAgente,
        model: "openrouter/anthropic/claude-3.5-sonnet",
        provider,
        credential_id: credentialId,
        channel_session_id: channelSessionId,
        pipeline_ids: [pipelineId],
        knowledge_source_ids: [ksId],
        tool_ids: toolIds,
        handoff_keywords: [
          "falar com humano",
          "atendente",
          "falar com a gisele",
          "humano",
          "pessoa real",
          "atendente humano",
          "urgência",
          "médico",
          "reclamação",
        ],
        handoff_tool_enabled: true,
      })
      .eq("id", versionId);
  } else {
    const { data: verRow, error: verErr } = await admin
      .from("ai_agent_versions")
      .insert({
        agent_id: agentId,
        organization_id: orgId,
        version_number: 1,
        system_prompt: promptAgente,
        model: "openrouter/anthropic/claude-3.5-sonnet",
        provider,
        credential_id: credentialId,
        channel_session_id: channelSessionId,
        pipeline_ids: [pipelineId],
        knowledge_source_ids: [ksId],
        tool_ids: toolIds,
        handoff_keywords: [
          "falar com humano",
          "atendente",
          "falar com a gisele",
          "humano",
          "pessoa real",
          "atendente humano",
          "urgência",
          "médico",
          "reclamação",
        ],
        handoff_tool_enabled: true,
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();

    if (verErr || !verRow) {
      throw new Error(`Erro ao criar versão do agente: ${verErr?.message}`);
    }
    versionId = verRow.id;
  }

  console.log("\n========================================================");
  console.log("TENANT 'Gisele Carniel' CONFIGURADO COM SUCESSO!");
  console.log("========================================================");
  console.log(`- Organização: ${org.display_name} (${orgId})`);
  console.log(`- Funil 'Agendamentos': 7 etapas configuradas (ID: ${pipelineId})`);
  console.log(`- Memória da Org: Regras institucionais e clínicas publicadas`);
  console.log(`- FAQ Conhecimento: ${faqItems.length} pares pergunta/resposta indexados (ID: ${ksId})`);
  console.log(`- Agente IA: 'Atendente Virtual Clínica InterLuz' (ID: ${agentId})`);
  console.log(`- Versão: v1 configurada com pacote 'vender', credencial OpenRouter e canal vinculados.`);
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("Erro na execução:", err.message);
  process.exit(1);
});
