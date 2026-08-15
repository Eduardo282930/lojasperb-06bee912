import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Tracks whether the current session belongs to an admin (store owner). */
export function useAdmin() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      setIsAdmin(false);
      setChecking(false);
      return false;
    }
    // Bootstrap: the first signed-in owner becomes admin while none exists.
    const { data: claimed } = await supabase.rpc("claim_admin");
    if (claimed === true) {
      setIsAdmin(true);
      setChecking(false);
      return true;
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const ok = Boolean(roles);
    setIsAdmin(ok);
    setChecking(false);
    return ok;
  }, []);

  useEffect(() => {
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void check();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [check]);

  return { isAdmin, checking, recheck: check };
}

export async function adminSignIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

export async function adminSignUp(email: string, password: string) {
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: `${window.location.origin}/eu` },
  });
}

export async function adminSignOut() {
  await supabase.auth.signOut();
}
