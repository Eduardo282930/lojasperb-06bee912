// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Banco oficial e único da SPERB: Supabase externo.
// Estes valores são públicos (URL + chave publicável) e substituem qualquer
// credencial injetada pelo ambiente de desenvolvimento.
const SUPABASE_URL = "https://cemxxuuzvrugmdpnejoq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PZd9pvB-Jocs0wESfBSsWg_RGM1t0j_";
const SUPABASE_PROJECT_ID = "cemxxuuzvrugmdpnejoq";

const j = (v: string) => JSON.stringify(v);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": j(SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": j(SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": j(SUPABASE_PROJECT_ID),
      "process.env.SUPABASE_URL": j(SUPABASE_URL),
      "process.env.SUPABASE_PUBLISHABLE_KEY": j(SUPABASE_PUBLISHABLE_KEY),
      "process.env.SUPABASE_ANON_KEY": j(SUPABASE_PUBLISHABLE_KEY),
      "process.env.SUPABASE_PROJECT_ID": j(SUPABASE_PROJECT_ID),
    },
  },
});
