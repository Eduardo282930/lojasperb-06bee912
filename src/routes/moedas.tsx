import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Ticket, Coins, Check } from "lucide-react";
import { useProfile } from "@/lib/coupons";
import {
  fetchCoinBalance,
  fetchCoinHistory,
  coinsToBRL,
  COIN_MAX_RATIO,
  fetchCheckinStatus,
  doCheckin,
  CHECKIN_REWARDS,
  CHECKIN_JACKPOT,
} from "@/lib/coins";
import { formatPrice } from "@/lib/cart";

export const Route = createFileRoute("/moedas")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Minhas moedas — SPERB" },
      {
        name: "description",
        content: "Saldo de moedas SPERB, valor em reais e histórico de movimentações.",
      },
      { property: "og:title", content: "Minhas moedas — SPERB" },
      {
        property: "og:description",
        content: "Veja seu saldo de moedas SPERB e use como desconto nos pedidos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MoedasPage,
});

const GOLD = "oklch(0.78 0.16 78)";
const GOLD_DARK = "oklch(0.72 0.17 62)";

function MoedasPage() {
  const profile = useProfile();
  const balanceQuery = useQuery({
    queryKey: ["coins", "balance", profile.phone],
    queryFn: () => fetchCoinBalance(profile.phone),
    staleTime: 30 * 1000,
  });
  const historyQuery = useQuery({
    queryKey: ["coins", "history", profile.phone],
    queryFn: () => fetchCoinHistory(profile.phone),
    staleTime: 30 * 1000,
  });

  const checkinQuery = useQuery({
    queryKey: ["coins", "checkin", profile.phone],
    queryFn: () => fetchCheckinStatus(profile.phone),
    staleTime: 30 * 1000,
  });
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const checkin = useMutation({
    mutationFn: () => doCheckin(profile.phone),
    onSuccess: (res) => {
      if (res.ok) {
        setMessage(
          res.bonus && res.bonus > 0
            ? `Parabéns! Você fez o check-in nº ${res.globalSeq} e ganhou ${res.coins} + ${res.bonus} moedas!`
            : `+${res.coins} moeda(s)! Volte amanhã para ganhar mais.`,
        );
      } else if (res.reason === "no_customer") {
        setMessage("Cadastre seu nome e telefone em “Eu” para fazer o check-in.");
      } else if (res.reason === "already") {
        setMessage("Você já fez o check-in de hoje. Volte amanhã!");
      } else {
        setMessage("Não foi possível fazer o check-in agora.");
      }
      void qc.invalidateQueries({ queryKey: ["coins"] });
    },
  });

  const balance = balanceQuery.data ?? 0;
  const history = historyQuery.data ?? [];
  const status = checkinQuery.data;
  const nextDay = status?.nextDay ?? 1;
  const checkedToday = status?.checkedToday ?? false;
  const doneDays = checkedToday ? nextDay : nextDay - 1;

  return (
    <div className="min-h-screen bg-muted pb-24">
      <header
        className="safe-top px-4 pb-16 pt-4 text-white"
        style={{ background: `linear-gradient(160deg, ${GOLD} 0%, ${GOLD_DARK} 100%)` }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link
            to="/eu"
            aria-label="Voltar"
            className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 active:scale-95"
          >
            <ArrowLeft className="h-7 w-7" strokeWidth={2.5} />
          </Link>
          <h1 className="text-2xl font-black">Minhas Moedas</h1>
          <Link
            to="/eu"
            aria-label="Cupons"
            className="ml-auto grid h-11 w-11 place-items-center rounded-2xl bg-white/20 active:scale-95"
          >
            <Ticket className="h-6 w-6" />
          </Link>
        </div>

        <div className="mx-auto mt-6 flex max-w-3xl items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/25 text-3xl font-black">
            <Coins className="h-8 w-8" strokeWidth={2.5} />
          </span>
          <div>
            <p className="text-5xl font-black leading-none">{balance}</p>
            <p className="mt-1 text-lg font-bold text-white/90">
              equivale a {formatPrice(coinsToBRL(balance))}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-10 max-w-3xl px-4">
        <section className="rounded-3xl border-2 border-border bg-card p-5 shadow-lg">
          <h2 className="text-xl font-black text-foreground">Check-in diário</h2>
          <p className="mt-1 text-base font-semibold text-muted-foreground">
            Faça o check-in todo dia e ganhe de 1 até 7 moedas. No 7º dia você pode
            ganhar até {CHECKIN_JACKPOT.toLocaleString("pt-BR")} moedas!
          </p>

          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {CHECKIN_REWARDS.map((reward, i) => {
              const day = i + 1;
              const done = day <= doneDays;
              return (
                <div
                  key={day}
                  className={`rounded-2xl border-2 px-1 py-2 text-center ${
                    done ? "border-transparent text-white" : "border-border bg-muted"
                  }`}
                  style={done ? { backgroundColor: GOLD_DARK } : undefined}
                >
                  <span className="block text-base font-black">
                    {done ? (
                      <Check className="mx-auto h-5 w-5" strokeWidth={3} />
                    ) : (
                      `+${reward}`
                    )}
                  </span>
                  <span className="block text-[11px] font-bold opacity-80">
                    {day === 7 ? "Dia 7 🎁" : `Dia ${day}`}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => checkin.mutate()}
            disabled={checkedToday || checkin.isPending}
            className="mt-4 w-full rounded-2xl py-4 text-xl font-black text-white shadow-md active:scale-[0.98] disabled:opacity-60"
            style={{ backgroundColor: checkedToday ? "oklch(0.6 0.02 80)" : GOLD_DARK }}
          >
            {checkedToday
              ? "Check-in de hoje feito ✓"
              : checkin.isPending
                ? "Registrando…"
                : `Faça o check-in e ganhe ${CHECKIN_REWARDS[nextDay - 1] ?? 1} moeda(s)`}
          </button>
          {message && (
            <p className="mt-3 text-center text-base font-bold text-foreground">{message}</p>
          )}
        </section>

        <section className="mt-4 rounded-3xl border-2 border-border bg-card p-5 shadow-lg">
          <h2 className="text-xl font-black text-foreground">Como usar</h2>
          <ul className="mt-2 flex flex-col gap-1 text-base font-semibold text-muted-foreground">
            <li>• Cada moeda vale R$ 0,01 de desconto.</li>
            <li>
              • Use até {Math.round(COIN_MAX_RATIO * 100)}% do valor do pedido em moedas.
            </li>
            <li>• Marque “Usar minhas moedas” na sacola antes de enviar o pedido.</li>
          </ul>
          <Link
            to="/sacola"
            className="mt-4 block rounded-2xl py-4 text-center text-xl font-black text-white shadow-md active:scale-[0.98]"
            style={{ backgroundColor: GOLD_DARK }}
          >
            Usar moedas na sacola
          </Link>
        </section>

        <section className="mt-4 rounded-3xl border-2 border-border bg-card p-5 shadow-sm">
          <h2 className="text-xl font-black text-foreground">Histórico</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-base font-semibold text-muted-foreground">
              Você ainda não tem movimentações de moedas.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y-2 divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold text-foreground">
                      {h.reason || "movimentação"}
                    </span>
                    <span className="block text-sm font-semibold text-muted-foreground">
                      {new Date(h.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-xl font-black ${
                      h.delta >= 0
                        ? "text-[oklch(0.62_0.19_145)]"
                        : "text-[oklch(0.58_0.22_25)]"
                    }`}
                  >
                    {h.delta > 0 ? `+${h.delta}` : h.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
