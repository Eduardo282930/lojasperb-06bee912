import type { ReactNode } from "react";
import {
  ClipboardList,
  CreditCard,
  LockKeyhole,
  PackageSearch,
  Receipt,
  Star,
  Ticket,
  Users,
  UserSearch,
} from "lucide-react";

/** Identificador de cada módulo do ERP administrativo. */
export type ModuleId =
  | "inicio"
  | "pedidos"
  | "pagamentos"
  | "clientes"
  | "duplicidades"
  | "destaques"
  | "cupons"
  | "estoque"
  | "recibos"
  | "desenvolvimento";

export type AdminModule = {
  id: ModuleId;
  label: string;
  short: string;
  hint: string;
  /** Cor própria do módulo (oklch), usada no menu e no cabeçalho. */
  color: string;
  icon: ReactNode;
};

const ICON = "h-6 w-6";

export const ADMIN_MODULES: AdminModule[] = [
  {
    id: "pedidos",
    label: "Pedidos",
    short: "Pedidos",
    hint: "Status, pagamento e entrega",
    color: "oklch(0.55 0.22 255)",
    icon: <ClipboardList className={ICON} />,
  },
  {
    id: "clientes",
    label: "Clientes",
    short: "Clientes",
    hint: "Histórico, compras e moedas",
    color: "oklch(0.62 0.14 210)",
    icon: <Users className={ICON} />,
  },
  {
    id: "duplicidades",
    label: "Revisão de cadastros",
    short: "Cadastros",
    hint: "Possíveis clientes repetidos",
    color: "oklch(0.70 0.16 65)",
    icon: <UserSearch className={ICON} />,
  },
  {
    id: "destaques",
    label: "Destaques da vitrine",
    short: "Destaques",
    hint: "Produtos que aparecem primeiro",
    color: "oklch(0.74 0.16 90)",
    icon: <Star className={ICON} />,
  },
  {
    id: "cupons",
    label: "Cupons",
    short: "Cupons",
    hint: "Criar, editar e desativar",
    color: "oklch(0.62 0.20 350)",
    icon: <Ticket className={ICON} />,
  },
  {
    id: "estoque",
    label: "Meu estoque",
    short: "Estoque",
    hint: "Estoque, custos e valor da mercadoria",
    color: "oklch(0.62 0.19 145)",
    icon: <PackageSearch className={ICON} />,
  },
  {
    id: "recibos",
    label: "Recibos Loyverse",
    short: "Recibos",
    hint: "Vendas registradas na loja",
    color: "oklch(0.52 0.20 275)",
    icon: <Receipt className={ICON} />,
  },
  {
    id: "desenvolvimento",
    label: "Modo desenvolvimento",
    short: "Manutenção",
    hint: "Bloquear a loja durante manutenção",
    color: "oklch(0.58 0.22 25)",
    icon: <LockKeyhole className={ICON} />,
  },
];

export const MODULE_IDS: ModuleId[] = [
  "inicio",
  ...ADMIN_MODULES.map((m) => m.id),
];

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (MODULE_IDS as string[]).includes(value);
}

export function moduleById(id: ModuleId): AdminModule | null {
  return ADMIN_MODULES.find((m) => m.id === id) ?? null;
}

export const HOME_COLOR = "oklch(0.55 0.22 255)";
