import type { ReactNode } from "react";
import { LayoutGrid, LogOut } from "lucide-react";
import { ADMIN_MODULES, HOME_COLOR, moduleById, type ModuleId } from "./admin-modules";

/**
 * Casca do ERP administrativo.
 * Computador/tablet: menu lateral fixo. Celular: faixa de módulos redondos.
 */
export function AdminShell({
  active,
  onSelect,
  onSignOut,
  children,
}: {
  active: ModuleId;
  onSelect: (id: ModuleId) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const current = moduleById(active);
  const title = current?.label ?? "Administração SPERB";
  const hint = current?.hint ?? "Painel de controle da loja";
  const color = current?.color ?? HOME_COLOR;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-[1400px]">
        {/* Menu lateral — computador e tablet grande */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card lg:flex">
          <div className="flex items-center gap-3 border-b px-4 py-4">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white"
              style={{ backgroundColor: HOME_COLOR }}
            >
              <LayoutGrid className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-foreground">SPERB ERP</p>
              <p className="truncate text-[11px] font-semibold text-muted-foreground">
                Painel administrativo
              </p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-3">
            <SideItem
              label="Início"
              color={HOME_COLOR}
              icon={<LayoutGrid className="h-5 w-5" />}
              active={active === "inicio"}
              onClick={() => onSelect("inicio")}
            />
            <p className="mt-4 mb-1 px-3 text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">
              Módulos
            </p>
            {ADMIN_MODULES.map((m) => (
              <SideItem
                key={m.id}
                label={m.label}
                color={m.color}
                icon={m.icon}
                active={active === m.id}
                onClick={() => onSelect(m.id)}
              />
            ))}
          </nav>

          <button
            type="button"
            onClick={onSignOut}
            className="m-3 inline-flex items-center justify-center gap-2 rounded-2xl bg-muted px-3 py-2.5 text-sm font-black text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="layer-header safe-top sticky top-0 border-b bg-background/95 backdrop-blur">
            <div className="px-4 py-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white lg:hidden"
                    style={{ backgroundColor: color }}
                  >
                    {current?.icon ?? <LayoutGrid className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-black text-foreground sm:text-xl">
                      {title}
                    </h1>
                    <p className="truncate text-xs font-semibold text-muted-foreground">
                      {hint}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm font-black text-foreground lg:hidden"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>

              {/* Faixa de módulos — celular e tablet */}
              <div className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
                <ModuleRound
                  label="Início"
                  color={HOME_COLOR}
                  icon={<LayoutGrid className="h-6 w-6" />}
                  active={active === "inicio"}
                  onClick={() => onSelect("inicio")}
                />
                {ADMIN_MODULES.map((m) => (
                  <ModuleRound
                    key={m.id}
                    label={m.short}
                    color={m.color}
                    icon={m.icon}
                    active={active === m.id}
                    onClick={() => onSelect(m.id)}
                  />
                ))}
              </div>
            </div>
          </header>

          <main className="px-4 pb-28 pt-4 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

function SideItem({
  label,
  color,
  icon,
  active,
  onClick,
}: {
  label: string;
  color: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors"
      style={{
        backgroundColor: active
          ? `color-mix(in oklab, ${color} 14%, transparent)`
          : "transparent",
      }}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
        style={{ backgroundColor: color, opacity: active ? 1 : 0.85 }}
      >
        <span className="[&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      </span>
      <span
        className="min-w-0 flex-1 truncate text-sm font-black"
        style={{ color: active ? color : "var(--foreground)" }}
      >
        {label}
      </span>
    </button>
  );
}

function ModuleRound({
  label,
  color,
  icon,
  active,
  onClick,
}: {
  label: string;
  color: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex w-[72px] shrink-0 flex-col items-center gap-1 active:scale-95"
    >
      <span
        className="grid h-14 w-14 place-items-center rounded-full border-2 text-white shadow-sm transition-all"
        style={{
          backgroundColor: color,
          borderColor: active ? color : "transparent",
          boxShadow: active ? `0 0 0 4px color-mix(in oklab, ${color} 22%, transparent)` : undefined,
          opacity: active ? 1 : 0.9,
        }}
      >
        {icon}
      </span>
      <span
        className="w-full whitespace-normal break-words text-center text-[11px] font-black leading-tight"
        style={{ color: active ? color : "var(--foreground)" }}
      >
        {label}
      </span>
    </button>
  );
}
