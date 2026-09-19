import { createClient } from "@supabase/supabase-js";
import { credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

async function main() {
  const creds = credenciaisSupabaseDeTeste();
  const supabase = createClient(creds.url, creds.serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== 1. BUSCANDO USUÁRIO: clinicaintegramente01@gmail.com ===");
  const { data: authUsers, error: errAuth } = await supabase.auth.admin.listUsers();
  const user = authUsers?.users?.find((u) => u.email?.toLowerCase().includes("clinicaintegramente01"));
  console.log("Auth User:", user?.id, user?.email, errAuth ? `Error: ${errAuth.message}` : "");

  let orgId = "";
  if (user) {
    const { data: orgs } = await supabase
      .from("user_organizations")
      .select("organization_id, role")
      .eq("user_id", user.id);
    console.log("User Orgs:", orgs);
    if (orgs && orgs.length > 0) {
      orgId = orgs[0].organization_id;
    }
  }

  if (!orgId) {
    const { data: anyOrg } = await supabase.from("organizations").select("id, name").limit(5);
    console.log("Orgs existentes:", anyOrg);
    if (anyOrg && anyOrg.length > 0) orgId = anyOrg[0].id;
  }

  console.log("=== 2. TIPOS DE ATENDIMENTO (calendar_event_types) NA ORG ===", orgId);
  const { data: eventTypes, error: errTypes } = await supabase
    .from("calendar_event_types")
    .select("id, name, slug, is_active, default_owner_user_id, duration_minutes, location_kind, requires_confirmation")
    .eq("organization_id", orgId);
  console.log("Tipos de agendamento:", eventTypes, errTypes ? `Error: ${errTypes.message}` : "");

  console.log("=== 3. CONEXÃO GOOGLE CALENDAR (calendar_connections) ===");
  const { data: googleCal, error: errGoogle } = await supabase
    .from("calendar_connections")
    .select("id, user_id, provider, account_email, status, last_sync_at, last_sync_error")
    .eq("organization_id", orgId);
  console.log("Calendar Connections:", googleCal, errGoogle ? `Error: ${errGoogle.message}` : "");

  console.log("=== 4. CONFIGURAÇÃO DO AGENTE PUBLICADO ===");
  const { data: agents, error: errAgent } = await supabase
    .from("ai_agents")
    .select("id, name, published_version_id")
    .eq("organization_id", orgId);
  console.log("Agents:", agents);

  if (agents && agents.length > 0) {
    for (const a of agents) {
      if (a.published_version_id) {
        const { data: ver } = await supabase
          .from("ai_agent_versions")
          .select("id, tool_ids, cases_enabled")
          .eq("id", a.published_version_id)
          .single();
        console.log(`Agent ${a.name} (tool_ids):`, ver?.tool_ids);
      }
    }
  }
}

main().catch(console.error);
