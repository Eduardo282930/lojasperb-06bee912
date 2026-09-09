import type { ReactNode } from "react";
import { Search } from "lucide-react";

/** Cabeçalho padrão de cada módulo: cor, ícone, título e ação principal. */
export function ModuleHeader({
  color,
  icon,
  title,
  hint,
  action,
}: {
  color: string;
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="mb-4 rounded-3xl border bg-card p-4 shadow-sm"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)` }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-sm"
            style={{ backgroundColor: color }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-foreground sm:text-xl">
              {title}
            </h2>
            {hint && (
              <p className="truncate text-xs font-semibold text-muted-foreground sm:text-sm">
                {hint}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

/** Barra de ferramentas: busca à esquerda, filtros/ações à direita. */
export function Toolbar({
  value,
  onChange,
  placeholder = "Buscar…",
  children,
}: {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      {onChange && (
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border bg-card px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none"
          />
        </label>
      )}
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

/** Pílula de filtro com contador opcional. */
export function FilterPill({
  label,
  count,
  active,
  color,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="tap-target inline-flex items-center gap-2 rounded-full border-2 px-3.5 py-2 text-sm font-black transition-colors"
      style={{
        borderColor: active ? color : "var(--border)",
        backgroundColor: active
          ? `color-mix(in oklab, ${color} 14%, transparent)`
          : "var(--card)",
        color: active ? color : "var(--muted-foreground)",
      }}
    >
      {label}
      {typeof count === "number" && (
        <span
          className="rounded-full px-1.5 text-xs font-black text-white"
          style={{ backgroundColor: active ? color : "var(--muted-foreground)" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Cartão de indicador do painel inicial. */
export function StatCard({
  label,
  value,
  hint,
  color,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  color: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white"
          style={{ backgroundColor: color }}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-black leading-none text-foreground">{value}</p>
      {hint && (
        <p className="mt-1 text-xs font-semibold text-muted-foreground">{hint}</p>
      )}
    </>
  );

  if (!onClick) {
    return <div className="rounded-2xl border bg-card p-3.5 shadow-sm">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-transform active:scale-[0.98]"
    >
      {inner}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
      {icon && (
        <div className="mb-2 flex justify-center text-muted-foreground">{icon}</div>
      )}
      <p className="text-base font-black text-foreground">{title}</p>
      {hint && (
        <p className="mt-1 text-sm font-semibold text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Moldura branca padrão dos conteúdos de módulo. */
export function PanelCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border bg-card p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}
