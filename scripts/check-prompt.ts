import { createClient } from "@supabase/supabase-js";
import { credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

async function run() {
  const creds = credenciaisSupabaseDeTeste();
  const sb = createClient(creds.url, creds.serviceRole);
  const { data: ver } = await sb
    .from("ai_agent_versions")
    .select("id, system_prompt, tool_ids")
    .eq("id", "0f0c0876-426f-4d7e-9c1f-44e6076aaf02")
    .single();
  console.log("=== VERSAO PUBLICADA ===");
  console.log("TOOL_IDS:", ver?.tool_ids);
  console.log("PROMPT:\n", ver?.system_prompt);
}

run().catch(console.error);
