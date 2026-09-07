import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin, adminSignIn, adminSignOut } from "@/lib/admin";

const STORE_KEY = "sperb";
const SETTING_KEY = "development_mode";

function readEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const value = (settings as Record<string, unknown>)[SETTING_KEY];
  return value === true;
}

export async function fetchDevelopmentMode(): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_development_mode");
  if (error) {
    console.error("[SPERB] Não foi possível consultar o modo desenvolvimento:", error);
    return false;
  }
  return data === true;
}

export async function setDevelopmentMode(enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_development_mode", {
    p_enabled: enabled,
  });
  if (error) {
    console.error("[SPERB] Não foi possível alterar o modo desenvolvimento:", error);
    return false;
  }
  return data === true;
}

export function useDevelopmentMode() {
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    void fetchDevelopmentMode().then((value) => {
      if (!alive) return;
      setEnabled(value);
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { enabled, checking };
}

export function DevelopmentGate() {
  const { enabled, checking } = useDevelopmentMode();
  const { isAdmin, checking: checkingAdmin, recheck } = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (checking || (enabled && checkingAdmin)) return <DevelopmentLoading />;
  if (!enabled || isAdmin) return null;

  async function enterAsAdmin() {
    setError("");
    setBusy(true);
    try {
      const { error: signInError } = await adminSignIn(email, password);
      if (signInError) {
        setError("E-mail ou senha incorretos.");
        return;
      }
      const ok = await recheck();
      if (!ok) {
        await adminSignOut();
        setError("Esta conta não tem permissão de administrador.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid min-h-screen place-items-center overflow-y-auto bg-background px-5 py-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-[2rem] bg-primary/10 text-primary shadow-sm">
          <LockKeyhole className="h-12 w-12" strokeWidth={2.2} aria-hidden="true" />
        </div>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.16em] text-primary">
          SPERB
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground">
          Estamos melhorando a loja
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-base font-semibold leading-6 text-muted-foreground">
          O aplicativo está temporariamente em manutenção para receber melhorias e correções. Volte em breve.
        </p>

        <div className="mt-8 rounded-3xl border-2 border-border bg-card p-5 text-left shadow-lg">
          <p className="text-lg font-black text-foreground">Acesso do administrador</p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Somente o administrador pode entrar enquanto a loja está em manutenção.
          </p>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="E-mail do administrador"
            className="mt-4 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-semibold text-foreground outline-none focus:border-primary"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="Senha"
            onKeyDown={(e) => e.key === "Enter" && void enterAsAdmin()}
            className="mt-3 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-semibold text-foreground outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void enterAsAdmin()}
            disabled={busy}
            className="mt-4 w-full rounded-2xl bg-primary px-4 py-3.5 text-base font-black text-primary-foreground transition-opacity disabled:opacity-60"
          >
            {busy ? "Entrando…" : "Entrar como administrador"}
          </button>
          {error && <p className="mt-3 text-sm font-bold text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function DevelopmentLoading() {
  return (
    <div className="fixed inset-0 z-[100] grid min-h-screen place-items-center bg-background">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <p className="mt-4 text-base font-bold text-muted-foreground">Verificando a loja…</p>
      </div>
    </div>
  );
}
