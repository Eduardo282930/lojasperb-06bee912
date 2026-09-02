import { useCanGoBack, useRouter, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * Voltar de verdade: sempre retorna à tela de onde o cliente veio.
 * Só cai no destino padrão quando não existe histórico (link aberto direto).
 */
export function BackButton({
  fallback = "/",
  className = "grid h-12 w-12 place-items-center rounded-2xl bg-muted text-foreground active:scale-95",
  iconClassName = "h-7 w-7",
  onBack,
}: {
  fallback?: string;
  className?: string;
  iconClassName?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  return (
    <button
      type="button"
      aria-label="Voltar"
      onClick={() => {
        onBack?.();
        if (canGoBack) router.history.back();
        else void navigate({ to: fallback });
      }}
      className={className}
    >
      <ArrowLeft className={iconClassName} strokeWidth={2.5} />
    </button>
  );
}
