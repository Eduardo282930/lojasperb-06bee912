/**
 * Splash de abertura: mostra o logo oficial da SPERB quando o app abre.
 * Aparece uma vez por sessão e some sozinho (sem travar a tela).
 */

import { useEffect, useState } from "react";
import { useStoreLogo } from "@/lib/store-logo";

const SESSION_KEY = "sperb-splash-shown";

export function Splash() {
  const logo = useStoreLogo();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return;
    window.sessionStorage.setItem(SESSION_KEY, "1");
    setVisible(true);
    const fade = window.setTimeout(() => setFading(true), 2000);
    const hide = window.setTimeout(() => setVisible(false), 2500);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(hide);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[100] grid place-items-center bg-background transition-opacity duration-500 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        {logo ? (
          <img
            src={logo}
            alt="SPERB"
            className="h-44 w-auto max-w-[82vw] object-contain"
          />
        ) : (
          <span className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" />
        )}
      </div>
    </div>
  );
}
