import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function createSupabaseAdminClient() {
  // Banco oficial da SPERB: Supabase externo (EXT_*). Sem fallback para outro banco.
  const SUPABASE_URL = process.env["EXT_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];

    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")}`,
    );
  }

  return createClient<Database>(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

let _supabaseAdmin:
  | ReturnType<typeof createSupabaseAdminClient>
  | undefined;

export const supabaseAdmin = new Proxy(
  {} as ReturnType<typeof createSupabaseAdminClient>,
  {
    get(_, prop, receiver) {
      if (!_supabaseAdmin) {
        _supabaseAdmin = createSupabaseAdminClient();
      }

      return Reflect.get(_supabaseAdmin, prop, receiver);
    },
  },
);