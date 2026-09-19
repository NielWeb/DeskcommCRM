import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

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

interface TemplateInput {
  title: string;
  shortcut: string;
  body: string;
}

const TEMPLATES_GISELE: TemplateInput[] = [
  {
    title: "Boas-vindas e Apresentação",
    shortcut: "/ola",
    body: "Olá! Tudo bem? Seja bem-vindo(a) à Clínica InterLuz. 😊\nSou da equipe de atendimento da clínica (Responsável técnica: Gisele Carniel, CRP 06/160907).\nComo posso ajudar você hoje? Você procura atendimento em Psicologia, Terapia de Casal, Psiquiatria ou Avaliação Neuropsicológica?",
  },
  {
    title: "Psicoterapia Individual (Valores e Formato)",
    shortcut: "/psico",
    body: "A psicoterapia individual oferece um espaço seguro e acolhedor para compreender emoções, comportamentos e desafios do cotidiano.\n\n• Sessão avulsa: R$ 177\n• Pacote mensal com 4 sessões: R$ 700\n\nAtendemos nas modalidades presencial e on-line. Qual modalidade você prefere para verificarmos os horários disponíveis?",
  },
  {
    title: "Terapia de Casal (Valores e Formato)",
    shortcut: "/casal",
    body: "A terapia de casal proporciona um espaço neutro e mediado por profissional para aprimorar o diálogo, compreender conflitos e fortalecer a relação.\n\n• Pacote com 4 sessões: R$ 800 (equivalente a R$ 200 por sessão)\n\nGostaria de verificar as opções de horários na agenda para a primeira sessão?",
  },
  {
    title: "Consulta Psiquiátrica (Avaliação Médica)",
    shortcut: "/psiquiatria",
    body: "A consulta psiquiátrica é uma avaliação médica completa da saúde mental para conhecer seu histórico, sintomas e definir o melhor plano de cuidado.\n\n• Valor da consulta: R$ 567\n\nAtendemos de forma presencial e por telemedicina. Gostaria de agendar para qual período (manhã ou tarde)?",
  },
  {
    title: "Avaliação Neuropsicológica (Informações e Valores)",
    shortcut: "/neuro",
    body: "A avaliação neuropsicológica investiga funções cognitivas como atenção, memória, raciocínio, aprendizagem e funções executivas (muito indicada para investigação de TDAH, autismo e dificuldades de desempenho).\n\n• Presencial: R$ 2.497\n• On-line: R$ 1.897 (necessário computador com câmera e internet estável)\n\nFormas de pagamento:\n- PIX à vista com 5% de desconto\n- Cartão de crédito parcelado\n- PIX parcelado por sessão conforme as etapas\n\nA procura seria para você ou para outra pessoa (filho/familiar)?",
  },
  {
    title: "Convênios e Reembolso",
    shortcut: "/convenio",
    body: "Nossos atendimentos são particulares, porém temos uma condição especial para conveniados a partir de R$ 150 (sujeita à confirmação prévia para sua operadora e especialidade).\n\nAlém disso, emitimos recibo e nota fiscal completa para você solicitar reembolso junto ao seu plano de saúde.\nQual é a sua operadora de saúde e qual especialidade você procura?",
  },
  {
    title: "Localização e Endereço da Clínica",
    shortcut: "/endereco",
    body: "📍 Clínica InterLuz — Psicologia e Psiquiatria\nRua José Bianchi, 555, sala 915 — Ribeirão Preto/SP.\n\nPrédio comercial moderno, com acessibilidade e facilidade de estacionamento no local e proximidades.\nLocalização no Google Maps: https://maps.google.com/?q=Rua+Jose+Bianchi+555+Ribeirao+Preto",
  },
  {
    title: "Dados de Pagamento (PIX)",
    shortcut: "/pix",
    body: "Para confirmação do seu horário, seguem os dados para pagamento via PIX:\n\n• Chave PIX: (16) 99293-2930\n• Favorecido: Clínica InterLuz / Gisele Carniel\n\nAssim que fizer a transferência, por favor nos envie o comprovante por aqui para registrarmos sua confirmação na agenda!",
  },
  {
    title: "Confirmação de Agendamento",
    shortcut: "/confirmado",
    body: "Seu agendamento foi confirmado com sucesso! ✅\n\n• Especialidade: [Inserir Especialidade]\n• Data e Horário: [Inserir Data/Hora]\n• Modalidade: [Presencial / On-line]\n\nCaso o atendimento seja on-line, enviaremos o link da sala virtual 15 minutos antes. Se precisar remarcar, pedimos a gentileza de avisar com ao menos 24 horas de antecedência. Nos vemos em breve!",
  },
  {
    title: "Acolhimento em Crise / Emergência (SAMU / CVV)",
    shortcut: "/crise",
    body: "Sinto muito que você esteja passando por um momento difícil. Se você estiver em sofrimento agudo ou não estiver em segurança agora, por favor busque apoio imediato:\n\n• SAMU: Ligue 192 (atendimento de emergência)\n• CVV: Ligue 188 (ligação gratuita, acolhimento 24h)\n• Procure a emergência médica mais próxima ou chame alguém de sua confiança.\n\nNossa equipe foi informada da sua mensagem e responderá assim que possível. Você não está sozinho(a).",
  },
  {
    title: "Recado para Gisele Carniel",
    shortcut: "/gisele",
    body: "Com certeza! Já registrei o seu recado diretamente para a psicóloga Gisele Carniel. Ela está em atendimento no momento, mas nossa equipe ou ela mesma retornará assim que houver um intervalo nas sessões.\nPara adiantarmos, pode me contar brevemente qual é o assunto do contato?",
  },
  {
    title: "Retorno para 'Vou Pensar'",
    shortcut: "/pensar",
    body: "Claro, fique totalmente à vontade! É uma decisão importante e deve ser tomada no seu tempo.\nFicou alguma dúvida sobre os profissionais, a abordagem ou os valores que eu possa esclarecer para ajudar na sua escolha? Estamos à disposição sempre que precisar!",
  },
  {
    title: "Objeção de Preço / Condições Facilitadas",
    shortcut: "/condicoes",
    body: "Entendemos perfeitamente. O cuidado com a saúde mental é fundamental e queremos facilitar seu acesso ao atendimento.\nConseguimos parcelamento no cartão de crédito ou 5% de desconto à vista via PIX, além dos pacotes mensais com valor reduzido por sessão.\nGostaria que verificássemos a melhor condição para o seu caso?",
  },
];

async function main() {
  const { url, serviceRole } = carregarEnv();
  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, display_name, slug")
    .eq("slug", "gisele-carniel")
    .limit(1);

  if (orgErr || !orgs || orgs.length === 0) {
    throw new Error(`Tenant 'gisele-carniel' não encontrado: ${orgErr?.message}`);
  }

  const org = orgs[0];
  const orgId = org.id;
  console.log(`Organização: ${org.display_name} (${orgId})`);

  // Localizar admin da organização para preencher created_by_user_id
  const { data: userOrgs } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .limit(1);
  const userId = userOrgs?.[0]?.user_id || null;

  // Buscar templates já existentes para evitar duplicatas
  const { data: existentes } = await admin
    .from("message_templates")
    .select("id, title, shortcut")
    .eq("organization_id", orgId);

  const titulosExistentes = new Set((existentes || []).map((t) => t.title.toLowerCase()));
  const atalhosExistentes = new Set(
    (existentes || []).map((t) => (t.shortcut ? t.shortcut.toLowerCase() : "")),
  );

  let criados = 0;
  let pulados = 0;

  for (const t of TEMPLATES_GISELE) {
    if (titulosExistentes.has(t.title.toLowerCase()) || atalhosExistentes.has(t.shortcut.toLowerCase())) {
      console.log(`Template já existe (pulando): ${t.title} [${t.shortcut}]`);
      pulados++;
      continue;
    }

    const { error: insErr } = await admin.from("message_templates").insert({
      organization_id: orgId,
      owner_user_id: null, // Compartilhado com toda a equipe
      created_by_user_id: userId,
      title: t.title,
      shortcut: t.shortcut,
      body: t.body,
    });

    if (insErr) {
      console.error(`Erro ao cadastrar ${t.title}:`, insErr.message);
    } else {
      console.log(`✓ Cadastrado: ${t.title} [${t.shortcut}]`);
      criados++;
    }
  }

  console.log(`Finalizado! Criados: ${criados}, Existentes: ${pulados}`);
}

main().catch((err) => {
  console.error("Falha ao executar:", err);
  process.exit(1);
});
