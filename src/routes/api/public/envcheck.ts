import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/envcheck")({
  server: { handlers: { GET: async () => Response.json({
    loy: Boolean(process.env["LOYVERSE_TOKEN"]),
    ext: Boolean(process.env["EXT_SUPABASE_URL"]),
    key: Boolean(process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"]),
    ip: Boolean(process.env["INFINITEPAY_HANDLE"]),
    keys: Object.keys(process.env ?? {}).length,
  }) } } },
});
