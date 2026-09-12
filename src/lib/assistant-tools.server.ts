import { createClient } from "@supabase/supabase-js";
import * as ai from "./assistant.server";
import { syncCatalogFromLoyverse } from "./loyverse.functions";

function db() {
  const url = process.env["EXT_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Conexão externa não configurada.");
  return createClient(url, key, { auth: { persistSession: false } });
}

const tool = (name: string, description: string, parameters: Record<string, unknown>) => ({
  name,
  description,
  parameters: { type: "object", properties: parameters },
});

export const ADMIN_TOOLS = [
  tool("buscar_produtos", "Procura produtos no catálogo Loyverse por nome, SKU ou variação. Use antes de alterar um produto quando a referência não for um ID exato.", {
    query: { type: "string" },
  }),
  tool("alterar_produto", "Altera somente os campos explicitamente pedidos de um produto Loyverse: nome, custo, preço, categoria e disponibilidade para venda.", {
    itemId: { type: "string" },
    variantId: { type: "string" },
    nome: { type: "string" },
    custo: { type: "number" },
    preco: { type: "number" },
    categoriaId: { type: "string" },
    disponivel: { type: "boolean" },
  }),
  tool("alterar_estoque", "Ajusta ou define o estoque de uma variação do Loyverse. Use delta para somar/subtrair ou estoqueFinal para definir o valor exato.", {
    variantId: { type: "string" },
    delta: { type: "integer" },
    estoqueFinal: { type: "integer" },
  }),
  tool("buscar_pedidos", "Busca pedidos administrativos por texto, telefone, status ou ID.", {
    query: { type: "string" },
    status: { type: "string" },
    limite: { type: "integer" },
  }),
  tool("alterar_pedido", "Altera o status administrativo do pedido respeitando o fluxo do sistema. Use pagamentoNaEntrega para marcar pagamento na entrega.", {
    orderId: { type: "string" },
    status: { type: "string", enum: ["sent", "preparing", "shipping", "delivered", "canceled"] },
    paymentStatus: { type: "string", enum: ["pending", "paid", "refunded"] },
    pagamentoNaEntrega: { type: "boolean" },
    observacao: { type: "string" },
  }),
  tool("buscar_clientes", "Busca clientes no Loyverse por nome, telefone ou e-mail.", {
    query: { type: "string" },
  }),
  tool("alterar_cliente", "Atualiza nome, telefone ou e-mail de um cliente Loyverse identificado pelo id.", {
    customerId: { type: "string" },
    nome: { type: "string" },
    telefone: { type: "string" },
    email: { type: "string" },
  }),
  tool("ajustar_moedas", "Consulta e ajusta moedas de um cliente. Delta positivo adiciona; negativo remove.", {
    telefone: { type: "string" },
    delta: { type: "integer" },
    motivo: { type: "string" },
  }),
  tool("gerenciar_cupom", "Cria, altera ou exclui cupom usando a estrutura real do sistema SPERB.", {
    acao: { type: "string", enum: ["criar", "alterar", "excluir"] },
    id: { type: "string" },
    codigo: { type: "string" },
    descricao: { type: "string" },
    tipo: { type: "string", enum: ["percent", "fixed"] },
    valor: { type: "number" },
    ativo: { type: "boolean" },
    inicio: { type: "string" },
    expiracao: { type: "string" },
    minimoPedido: { type: "number" },
    limiteUsos: { type: "integer" },
    telefoneCliente: { type: "string" },
  }),
  tool("sincronizar_catalogo", "Sincroniza o catálogo do Loyverse com a base externa da SPERB.", {}),
];

function digits(value: string) { return value.replace(/\D/g, ""); }
function n(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

async function loy<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env["LOYVERSE_TOKEN"];
  if (!token) throw new Error("LOYVERSE_TOKEN ausente.");
  const res = await fetch(`https://api.loyverse.com/v1.0/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Loyverse ${path} ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return (await res.json()) as T;
}

async function listLoy<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor = "";
  do {
    const q = new URLSearchParams({ limit: "250" });
    if (cursor) q.set("cursor", cursor);
    const data = await loy<Record<string, unknown>>(`${path}?${q}`);
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    if (arrayKey) out.push(...((data[arrayKey] as T[]) ?? []));
    cursor = String(data.cursor ?? "");
  } while (cursor);
  return out;
}

function compactItem(item: any) {
  return {
    id: item.id,
    nome: item.item_name,
    sku: item.variants?.[0]?.sku ?? "",
    categoriaId: item.category_id ?? null,
    variacoes: (item.variants ?? []).map((v: any) => ({
      variantId: v.variant_id,
      variacao: [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(" / "),
      preco: n(v.default_price),
      custo: n(v.cost ?? v.purchase_cost),
      disponivel: v.stores?.some((s: any) => s.available_for_sale !== false) ?? true,
    })),
  };
}

async function findCustomerIdByPhone(phone: string): Promise<string> {
  const d = db();
  const { data, error } = await d.rpc("resolve_customer", { p_device_id: "", p_phone: digits(phone) });
  if (error || !data) throw new Error("Cliente não encontrado pelo telefone informado.");
  return String(data);
}

export async function executeAdminTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "buscar_produtos": {
      const q = ai.normalizeName(String(args.query ?? ""));
      const items = await ai.loadItems();
      const found = items.filter((i: any) => {
        const hay = ai.normalizeName(`${i.item_name} ${i.variants?.map((v: any) => [v.sku, v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(" ")).join(" ")}`);
        return !q || hay.includes(q);
      }).slice(0, 20);
      return { produtos: found.map(compactItem) };
    }
    case "alterar_produto": {
      const itemId = String(args.itemId ?? "");
      if (!itemId) throw new Error("itemId obrigatório.");
      const item: any = await ai.loyverse(`items/${itemId}`);
      const variants = Array.isArray(item.variants) ? item.variants : [];
      if (variants.length !== 1 && !args.variantId) throw new Error("Este produto possui variações. Preciso da variação exata antes de alterar.");
      const requestedVariant = args.variantId ? variants.find((x: any) => x.variant_id === String(args.variantId)) : undefined;
      if (args.variantId && !requestedVariant) throw new Error("Variação não encontrada neste produto.");
      const v = requestedVariant ?? variants[0];
      const store = await ai.storeId();
      const changed = { ...item } as any;
      if (args.nome !== undefined) changed.item_name = ai.cleanProductName(String(args.nome));
      if (args.categoriaId !== undefined) changed.category_id = String(args.categoriaId);
      changed.variants = variants.map((x: any) => {
        if (args.variantId && x.variant_id !== String(args.variantId)) return x;
        const next = { ...x };
        if (args.custo !== undefined) next.cost = Math.max(0, n(args.custo));
        if (args.preco !== undefined) next.default_price = Math.max(0, n(args.preco));
        const stores = Array.isArray(next.stores) ? next.stores.map((s: any) => ({ ...s })) : [];
        const idx = stores.findIndex((s: any) => s.store_id === store);
        const patch: any = { store_id: store, pricing_type: "FIXED" };
        if (args.preco !== undefined) patch.price = Math.max(0, n(args.preco));
        if (args.disponivel !== undefined) patch.available_for_sale = Boolean(args.disponivel);
        if (idx >= 0) stores[idx] = { ...stores[idx], ...patch };
        else if (args.preco !== undefined || args.disponivel !== undefined) stores.push(patch);
        if (stores.length) next.stores = stores;
        return next;
      });
      await ai.loyverse("items", { method: "POST", body: changed });
      const verify: any = await ai.loyverse(`items/${itemId}`);
      const vv = (verify.variants ?? []).find((x: any) => !args.variantId || x.variant_id === String(args.variantId));
      return { ok: true, produto: compactItem(verify), verificado: { nome: verify.item_name, preco: n(vv?.default_price), custo: n(vv?.cost) } };
    }
    case "alterar_estoque": {
      const variantId = String(args.variantId ?? "");
      if (!variantId) throw new Error("variantId obrigatório.");
      const store = await ai.storeId();
      const current = await ai.inventoryFor(variantId, store);
      const final = args.estoqueFinal !== undefined ? Math.trunc(n(args.estoqueFinal)) : current + Math.trunc(n(args.delta));
      if (final < 0) throw new Error("O estoque não pode ficar negativo.");
      await ai.setInventory(variantId, store, final);
      const verify = await ai.inventoryFor(variantId, store);
      if (verify !== final) throw new Error("O estoque não confirmou o valor solicitado.");
      return { ok: true, estoqueAnterior: current, estoqueFinal: verify, variantId };
    }
    case "buscar_pedidos": {
      const d = db();
      const limit = Math.min(100, Math.max(1, Math.trunc(n(args.limite) || 30)));
      let q = d.from("orders").select("*").order("created_at", { ascending: false }).limit(limit);
      if (args.status) q = q.eq("status", String(args.status));
      const { data, error } = await q;
      if (error) throw error;
      const query = ai.normalizeName(String(args.query ?? ""));
      const rows = (data ?? []).filter((r: any) => {
        if (!query) return true;
        return ai.normalizeName(`${r.id} ${r.customer_name ?? ""} ${r.customer_phone ?? ""} ${r.coupon_code ?? ""}`).includes(query);
      }).slice(0, limit);
      return { pedidos: rows.map((r: any) => ({ id: r.id, cliente: r.customer_name, telefone: r.customer_phone, total: n(r.total), status: r.status, pagamento: r.payment_status, criadoEm: r.created_at, itens: r.items })) };
    }
    case "alterar_pedido": {
      const d = db();
      const id = String(args.orderId ?? "");
      if (args.pagamentoNaEntrega) {
        const { data, error } = await d.rpc("admin_set_pay_on_delivery", { p_order_id: id });
        if (error || !data) throw new Error(error?.message ?? "Não foi possível marcar pagamento na entrega.");
      } else {
        const { data, error } = await d.rpc("admin_set_order_status", { p_order_id: id, p_status: String(args.status), p_payment_status: String(args.paymentStatus ?? "pending"), p_note: String(args.observacao ?? "") });
        if (error || !data) throw new Error(error?.message ?? "A alteração do pedido foi recusada pelo sistema.");
      }
      const { data: verify, error } = await d.from("orders").select("id,status,payment_status,payment_method").eq("id", id).maybeSingle();
      if (error || !verify) throw new Error("Alteração feita, mas não consegui verificar o pedido.");
      return { ok: true, pedido: verify };
    }
    case "buscar_clientes": {
      const q = ai.normalizeName(String(args.query ?? ""));
      const customers = await listLoy<any>("customers");
      const found = customers.filter(c => ai.normalizeName(`${c.name ?? ""} ${c.phone_number ?? ""} ${c.email ?? ""}`).includes(q)).slice(0, 30);
      return { clientes: found.map(c => ({ id: c.id, nome: c.name ?? "", telefone: c.phone_number ?? "", email: c.email ?? "" })) };
    }
    case "alterar_cliente": {
      const id = String(args.customerId ?? "");
      if (!id) throw new Error("customerId obrigatório.");
      const body: Record<string, unknown> = { id };
      if (args.nome !== undefined) body.name = String(args.nome).trim();
      if (args.telefone !== undefined) body.phone_number = String(args.telefone).trim();
      if (args.email !== undefined) body.email = String(args.email).trim().toLowerCase();
      const saved = await loy<any>("customers", { method: "POST", body: JSON.stringify(body) });
      return { ok: true, cliente: { id: saved.id, nome: saved.name ?? "", telefone: saved.phone_number ?? "", email: saved.email ?? "" } };
    }
    case "ajustar_moedas": {
      const customerId = await findCustomerIdByPhone(String(args.telefone ?? ""));
      const d = db();
      const requestedDelta = Math.trunc(n(args.delta));

      // O Assistente roda no servidor com service_role. Os RPCs admin_adjust_coins/
      // admin_coin_balance exigem auth.uid() com role "admin", então podem retornar
      // permission denied quando chamados por este contexto. Aqui fazemos a mesma
      // operação diretamente no ledger, usando service_role, e verificamos o saldo
      // real depois da gravação.
      const { data: beforeRows, error: beforeError } = await d
        .from("customer_coin_ledger")
        .select("delta")
        .eq("customer_id", customerId);

      if (beforeError) throw new Error(`Não foi possível consultar as moedas: ${beforeError.message}`);

      const beforeBalance = (beforeRows ?? []).reduce((sum: number, row: any) => sum + Math.trunc(n(row.delta)), 0);
      let appliedDelta = requestedDelta;

      // Nunca deixa o saldo ficar negativo, mantendo a mesma regra do RPC antigo.
      if (beforeBalance + appliedDelta < 0) {
        appliedDelta = -beforeBalance;
      }

      if (appliedDelta !== 0) {
        const { error: insertError } = await d.from("customer_coin_ledger").insert({
          customer_id: customerId,
          delta: appliedDelta,
          reason: String(args.motivo ?? "Ajuste pelo Assistente SPERB").trim() || "Ajuste pelo Assistente SPERB",
          created_by: null,
        });

        if (insertError) {
          throw new Error(`Não foi possível salvar as moedas: ${insertError.message}`);
        }
      }

      const { data: afterRows, error: afterError } = await d
        .from("customer_coin_ledger")
        .select("delta")
        .eq("customer_id", customerId);

      if (afterError) throw new Error(`As moedas foram alteradas, mas não consegui verificar o saldo: ${afterError.message}`);

      const saldo = (afterRows ?? []).reduce((sum: number, row: any) => sum + Math.trunc(n(row.delta)), 0);

      if (saldo !== beforeBalance + appliedDelta) {
        throw new Error("A alteração das moedas não foi confirmada pelo sistema.");
      }

      return {
        ok: true,
        telefone: args.telefone,
        delta: appliedDelta,
        deltaSolicitado: requestedDelta,
        saldoAnterior: beforeBalance,
        saldo,
      };
    }
    case "gerenciar_cupom": {
      const d = db();
      const action = String(args.acao);
      if (action === "excluir") {
        const id = String(args.id ?? "");
        if (!id) throw new Error("id do cupom obrigatório.");
        const { error } = await d.from("coupons").delete().eq("id", id);
        if (error) throw error;
        const { data: check } = await d.from("coupons").select("id").eq("id", id).maybeSingle();
        if (check) throw new Error("O cupom ainda existe após a exclusão.");
        return { ok: true, excluido: id };
      }
      const payload: Record<string, unknown> = {};
      const map: Record<string, string> = { codigo: "code", descricao: "description", tipo: "type", valor: "value", ativo: "active", inicio: "starts_at", expiracao: "expires_at", minimoPedido: "min_order", limiteUsos: "max_uses", telefoneCliente: "customer_phone" };
      for (const [from, to] of Object.entries(map)) if (args[from] !== undefined) payload[to] = args[from];
      if (payload.customer_phone) payload.customer_phone = digits(String(payload.customer_phone));
      if (action === "criar") {
        if (!payload.code || payload.value === undefined || !payload.type) throw new Error("Para criar cupom preciso de código, tipo e valor.");
        const { data, error } = await d.from("coupons").insert(payload).select("*").single();
        if (error) throw error;
        return { ok: true, cupom: data };
      }
      const id = String(args.id ?? "");
      if (!id) throw new Error("id do cupom obrigatório para alterar.");
      const { data, error } = await d.from("coupons").update(payload).eq("id", id).select("*").single();
      if (error) throw error;
      return { ok: true, cupom: data };
    }
    case "sincronizar_catalogo":
      await syncCatalogFromLoyverse();
      return { ok: true, mensagem: "Catálogo sincronizado." };
    default:
      throw new Error(`Função administrativa não disponível: ${name}`);
  }
}
