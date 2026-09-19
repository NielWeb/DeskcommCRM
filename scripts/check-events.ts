import { createClient } from "@supabase/supabase-js";
import { credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

async function run() {
  const creds = credenciaisSupabaseDeTeste();
  const sb = createClient(creds.url, creds.serviceRole);
  const { data: conv } = await sb.from('conversations').select('id, contact_id, status').limit(5);
  console.log('Conversas:', conv);

  const { data: logs } = await sb
    .from('event_log')
    .select('id, event_type, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('Ultimos event_logs:', logs?.map(l => ({ type: l.event_type, created_at: l.created_at, payload: l.payload })));

  const { data: llmCalls } = await sb
    .from('llm_calls')
    .select('id, purpose, tool_calls, error, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('Ultimas llm_calls:', JSON.stringify(llmCalls, null, 2));
}

run().catch(console.error);
