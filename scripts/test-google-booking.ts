import { carregarEnvLocal, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";
carregarEnvLocal();

import { createClient } from "@supabase/supabase-js";
import { horariosLivresDaOrg } from "../lib/agenda/consulta";
import { marcarAgendamentoHandler } from "../app/api/v1/agenda/agendamentos/_handler";

async function testBooking() {
  const creds = credenciaisSupabaseDeTeste();
  const supabase = createClient(creds.url, creds.serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgId = "ea5f1acc-07f3-40fa-9279-71fa2ea328f2";
  const userId = "99fa6276-3af5-4a36-ad77-5290cf2f4a26";

  console.log("=== TESTANDO CONSULTA DE SLOTS ===");
  const agora = new Date();
  const de = agora;
  const ate = new Date(agora.getTime() + 7 * 86_400_000);

  const consulta = await horariosLivresDaOrg(supabase, orgId, {
    eventTypeSlug: "consulta",
    ownerUserId: userId,
    de,
    ate,
    agora,
  });

  console.log("Resultado da consulta:", {
    ok: consulta.ok,
    codigo: consulta.ok ? "OK" : (consulta as any).codigo,
    motivo: consulta.ok ? "OK" : (consulta as any).motivoParaOperador,
    publicouHorarios: (consulta as any).publicouHorarios,
    totalSlots: consulta.ok ? consulta.slots.length : 0,
    primeiros3Slots: consulta.ok ? consulta.slots.slice(0, 3) : [],
  });

  if (!consulta.ok || consulta.slots.length === 0) {
    console.log("Nenhum slot disponível retornado!");
    return;
  }

  const slot = consulta.slots[0];
  console.log("Tentando agendar no primeiro slot disponível:", slot.inicio.toISOString());

  // Buscar contato de teste
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("organization_id", orgId)
    .ilike("name", "%Daniel%")
    .limit(1);

  const contactId = contacts && contacts.length > 0 ? contacts[0].id : null;
  console.log("Contato para teste:", contactId);

  // Buscar o event type id
  const { data: eventType } = await supabase
    .from("calendar_event_types")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("slug", "consulta")
    .single();

  if (!eventType) {
    console.log("Event type 'consulta' não encontrado!");
    return;
  }

  console.log("=== EXECUTANDO marcarAgendamentoHandler ===");
  try {
    const res = await marcarAgendamentoHandler(
      supabase,
      {
        organization_id: orgId,
        actor: { type: "ai_agent", id: "3b490148-e1ff-43a2-b7e8-fa05e0668234", role: "ai_operator" },
        requestId: "test-booking-cli",
      },
      {
        event_type_id: eventType.id,
        starts_at: slot.inicio.toISOString(),
        contact_id: contactId ?? undefined,
        title: "Consulta Teste Daniel Gaidys",
        notes: "Teste de agendamento automático",
      },
    );
    console.log("Agendamento criado com sucesso!", res);
  } catch (err: any) {
    console.error("Erro ao criar agendamento:", err?.message || err, err);
  }
}

testBooking().catch(console.error);
