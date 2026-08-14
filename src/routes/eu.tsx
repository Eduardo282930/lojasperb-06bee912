import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Ticket, Lock, Trash2, Check, Plus } from "lucide-react";
import {
  useCoupons,
  useProfile,
  useRedeemed,
  saveProfile,
  saveCoupon,
  deleteCoupon,
  redeemCoupon,
  unredeemCoupon,
  isAvailable,
  isExhausted,
  OWNER_PASSWORD,
  type Coupon,
} from "@/lib/coupons";
import { formatPrice } from "@/lib/cart";

export const Route = createFileRoute("/eu")({
  head: () => ({
    meta: [
      { title: "Eu — SPERB" },
      {
        name: "description",
        content: "Seus dados e cupons de desconto CUPOM SPERB para usar no pedido.",
      },
      { property: "og:title", content: "Eu — SPERB" },
      {
        property: "og:description",
        content: "Seus dados e cupons de desconto CUPOM SPERB para usar no pedido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EuPage,
});

function couponLabel(c: Coupon): string {
  return c.type === "percent" ? `${c.value}% OFF` : `${formatPrice(c.value)} OFF`;
}

function EuPage() {
  const profile = useProfile();
  const coupons = useCoupons();
  const redeemed = useRedeemed();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [saved, setSaved] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [passError, setPassError] = useState(false);

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            aria-label="Voltar"
            className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <ArrowLeft className="h-7 w-7" strokeWidth={2.5} />
          </Link>
          <h1 className="text-2xl font-black text-foreground">Eu</h1>
          <button
  type="button"
  onClick={() => {
    alert("CLIQUE FUNCIONOU");
    setOwnerOpen(true);
  }}
  aria-label="Área do proprietário"
  className="ml-auto grid h-11 w-11 place-items-center rounded-2xl border-2 border-border bg-card text-muted-foreground"
>
  <Lock className="h-5 w-5" />
</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        <section className="rounded-3xl border-2 border-border bg-card p-4">
          <h2 className="text-xl font-black text-foreground">Meus dados</h2>
          <label className="mt-3 block text-base font-bold text-muted-foreground">
            Nome
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className="mt-1 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none focus:border-[oklch(0.55_0.22_255)]"
            />
          </label>
          <label className="mt-3 block text-base font-bold text-muted-foreground">
            WhatsApp
            <input
              value={phone}
              maxLength={20}
              inputMode="tel"
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(51) 99999-9999"
              className="mt-1 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none focus:border-[oklch(0.55_0.22_255)]"
            />
          </label>
          <button
            onClick={() => {
              saveProfile({ name: name.trim(), phone: phone.trim() });
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
            className="mt-4 w-full rounded-2xl bg-[oklch(0.55_0.22_255)] py-4 text-xl font-black text-white active:scale-[0.98]"
          >
            {saved ? "Salvo!" : "Salvar cadastro"}
          </button>
          <p className="mt-2 text-sm text-muted-foreground">
            Cadastro completo em breve. Seus dados ficam salvos neste aparelho.
          </p>
        </section>

        <section className="mt-5">
          <h2 className="flex items-center gap-2 text-xl font-black text-foreground">
            <Ticket className="h-6 w-6" /> Cupons de desconto
          </h2>
          {coupons.filter(isAvailable).length === 0 ? (
            <p className="mt-3 rounded-2xl border-2 border-dashed border-border p-5 text-center text-lg text-muted-foreground">
              Nenhum cupom disponível no momento.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {coupons.filter(isAvailable).map((c) => {
                const isRedeemed = redeemed.includes(c.id);
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-3xl border-2 border-border bg-card p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-black text-foreground">
                        CUPOM SPERB · {c.code}
                      </p>
                      <p className="text-xl font-black text-[oklch(0.62_0.19_145)]">
                        {couponLabel(c)}
                      </p>
                      {c.description && (
                        <p className="text-base text-muted-foreground">{c.description}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Pedido mínimo: {formatPrice(c.minOrder)}
                        {c.maxUses !== null && ` · restam ${Math.max(0, c.maxUses - c.uses)} usos`}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        isRedeemed ? unredeemCoupon(c.id) : redeemCoupon(c.id)
                      }
                      className={`shrink-0 rounded-2xl px-4 py-3 text-lg font-black active:scale-95 ${
                        isRedeemed
                          ? "bg-[oklch(0.62_0.19_145)] text-white"
                          : "bg-[oklch(0.55_0.22_255)] text-white"
                      }`}
                    >
                      {isRedeemed ? "Resgatado" : "Resgatar"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            O resgate não garante o uso: o desconto é confirmado ao finalizar o pedido
            pelo WhatsApp, enquanto houver cupons disponíveis.
          </p>
        </section>

        {ownerOpen && !isOwner && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
    <section
      className="w-full max-w-md rounded-3xl border-2 border-border bg-card p-5 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-title"
    >
      <div className="flex items-center justify-between">
        <h2
          id="owner-title"
          className="text-xl font-black text-foreground"
        >
          Área do proprietário
        </h2>

        <button
          type="button"
          onClick={() => {
            setOwnerOpen(false);
            setPass("");
            setPassError(false);
          }}
          className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-xl font-black text-foreground active:scale-95"
          aria-label="Fechar"
        >
          ×
        </button>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        Digite a senha para acessar o gerenciamento de cupons.
      </p>

      <input
        type="password"
        inputMode="numeric"
        value={pass}
        onChange={(e) => {
          setPass(e.target.value);
          setPassError(false);
        }}
        placeholder="Senha"
        autoFocus
        className="mt-4 w-full rounded-2xl border-2 border-border bg-background px-4 py-4 text-lg font-semibold text-foreground outline-none focus:border-[oklch(0.55_0.22_255)]"
      />

      {passError && (
        <p className="mt-2 text-base font-bold text-[oklch(0.58_0.22_25)]">
          Senha incorreta.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOwnerOpen(false);
            setPass("");
            setPassError(false);
          }}
          className="flex-1 rounded-2xl bg-muted py-4 text-lg font-black text-foreground active:scale-[0.98]"
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={() => {
            if (pass === OWNER_PASSWORD) {
              setIsOwner(true);
              setOwnerOpen(false);
              setPass("");
              setPassError(false);
            } else {
              setPassError(true);
            }
          }}
          className="flex-1 rounded-2xl bg-[oklch(0.55_0.22_255)] py-4 text-lg font-black text-white active:scale-[0.98]"
        >
          Entrar
        </button>
      </div>
    </section>
  </div>
)}

        {isOwner && <OwnerPanel />}
      </main>
    </div>
  );
}

function emptyDraft(): Coupon {
  return {
    id: "",
    code: "",
    description: "",
    type: "percent",
    value: 10,
    minOrder: 0,
    maxUses: null,
    uses: 0,
    active: true,
  };
}

function OwnerPanel() {
  const coupons = useCoupons();
  const [draft, setDraft] = useState<Coupon>(emptyDraft());
  const [limited, setLimited] = useState(false);

  function submit() {
    const code = draft.code.trim().toUpperCase();
    if (!code) return;
    saveCoupon({
      ...draft,
      code,
      description: draft.description.trim(),
      value: Math.max(0, Number(draft.value) || 0),
      minOrder: Math.max(0, Number(draft.minOrder) || 0),
      maxUses: limited ? Math.max(1, Number(draft.maxUses) || 1) : null,
      id: draft.id || `cp_${Date.now()}`,
    });
    setDraft(emptyDraft());
    setLimited(false);
  }

  return (
    <section className="mt-6 rounded-3xl border-2 border-[oklch(0.55_0.22_255)] bg-card p-4">
      <h2 className="text-xl font-black text-foreground">Gerenciar cupons</h2>

      <div className="mt-3 flex flex-col gap-3">
        <input
          value={draft.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          maxLength={24}
          placeholder="Nome do cupom (ex: NATAL10)"
          className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
        />
        <input
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          maxLength={120}
          placeholder="O que ele faz (ex: 10% em toda a loja)"
          className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
        />
        <div className="flex gap-2">
          <select
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as Coupon["type"] })
            }
            className="rounded-2xl border-2 border-border bg-background px-3 py-3 text-lg font-bold text-foreground"
          >
            <option value="percent">% desconto</option>
            <option value="fixed">R$ desconto</option>
          </select>
          <input
            type="number"
            min={0}
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
            className="min-w-0 flex-1 rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
            placeholder="Valor"
          />
        </div>
        <input
          type="number"
          min={0}
          value={draft.minOrder}
          onChange={(e) => setDraft({ ...draft, minOrder: Number(e.target.value) })}
          placeholder="Valor mínimo do pedido (R$)"
          className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
        />
        <label className="flex items-center gap-3 text-lg font-bold text-foreground">
          <input
            type="checkbox"
            checked={limited}
            onChange={(e) => setLimited(e.target.checked)}
            className="h-6 w-6"
          />
          Limitar número de usos
        </label>
        {limited && (
          <input
            type="number"
            min={1}
            value={draft.maxUses ?? 1}
            onChange={(e) => setDraft({ ...draft, maxUses: Number(e.target.value) })}
            placeholder="Quantidade de usos"
            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-lg font-semibold text-foreground outline-none"
          />
        )}
        <button
          onClick={submit}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[oklch(0.55_0.22_255)] py-4 text-xl font-black text-white active:scale-[0.98]"
        >
          <Plus className="h-6 w-6" strokeWidth={3} /> Salvar cupom
        </button>
      </div>

      <h3 className="mt-6 text-lg font-black text-foreground">Cupons cadastrados</h3>
      {coupons.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Nenhum cupom ainda.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {coupons.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-2xl border-2 border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-black text-foreground">
                  {c.code} · {couponLabel(c)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Mín. {formatPrice(c.minOrder)} ·{" "}
                  {c.maxUses === null
                    ? "usos ilimitados"
                    : `${c.uses}/${c.maxUses} usos`}
                  {isExhausted(c) && " · esgotado"}
                </p>
              </div>
              <button
                onClick={() => saveCoupon({ ...c, active: !c.active })}
                className={`rounded-xl px-3 py-2 text-sm font-black ${
                  c.active
                    ? "bg-[oklch(0.62_0.19_145)] text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {c.active ? <Check className="h-4 w-4" /> : "Off"}
              </button>
              <button
                aria-label={`Excluir ${c.code}`}
                onClick={() => deleteCoupon(c.id)}
                className="rounded-xl bg-muted p-2 text-[oklch(0.58_0.22_25)]"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
