/**
 * Acesso administrativo — autenticação da Admin API do Medusa.js.
 */

import { useCallback, useEffect, useState } from "react";
import { adminToken, isMedusaConfigured, medusaFetch } from "@/lib/medusa";

export function useAdmin() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const check = useCallback(async () => {
    const token = adminToken.get();
    if (!token || !isMedusaConfigured()) {
      setIsAdmin(false);
      setChecking(false);
      return false;
    }
    try {
      await medusaFetch("/admin/users/me", { admin: true, token });
      setIsAdmin(true);
      setChecking(false);
      return true;
    } catch {
      adminToken.set(null);
      setIsAdmin(false);
      setChecking(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return { isAdmin, checking, recheck: check };
}

export async function adminSignIn(
  email: string,
  password: string,
): Promise<{ error: { message: string } | null }> {
  if (!isMedusaConfigured()) {
    return { error: { message: "Configure a URL e a chave do Medusa primeiro." } };
  }
  try {
    const res = await medusaFetch<{ token: string }>("/auth/user/emailpass", {
      method: "POST",
      admin: true,
      body: { email: email.trim(), password },
    });
    adminToken.set(res.token);
    return { error: null };
  } catch (err) {
    return { error: { message: (err as Error).message || "Login inválido" } };
  }
}

export async function adminSignOut() {
  adminToken.set(null);
}
