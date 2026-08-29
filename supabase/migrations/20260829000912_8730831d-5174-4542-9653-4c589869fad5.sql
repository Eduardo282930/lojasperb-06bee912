-- 1) Telefone normalizado pelos 8 últimos dígitos
DROP INDEX IF EXISTS public.customers_phone_digits_idx;
DROP INDEX IF EXISTS public.orders_phone_idx;

CREATE OR REPLACE FUNCTION public.only_digits(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 8)
$$;

CREATE INDEX IF NOT EXISTS customers_phone_digits_idx ON public.customers (public.only_digits(phone));
CREATE INDEX IF NOT EXISTS orders_phone_idx ON public.orders (public.only_digits(customer_phone));

-- 2) Check-in diário
CREATE TABLE IF NOT EXISTS public.customer_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_key text NOT NULL DEFAULT 'sperb',
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  streak_day integer NOT NULL DEFAULT 1,
  coins integer NOT NULL DEFAULT 1,
  bonus integer NOT NULL DEFAULT 0,
  global_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, day)
);

GRANT SELECT ON public.customer_checkins TO authenticated;
GRANT ALL ON public.customer_checkins TO service_role;

ALTER TABLE public.customer_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view checkins"
ON public.customer_checkins FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Situação atual do check-in do cliente
CREATE OR REPLACE FUNCTION public.checkin_status(p_device_id text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer uuid := public.resolve_customer(p_device_id, p_phone);
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_last date;
  v_streak integer := 0;
  v_done boolean := false;
  v_total bigint;
BEGIN
  SELECT count(*) INTO v_total FROM public.customer_checkins;
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('streak', 0, 'checked_today', false, 'next_day', 1, 'global_total', v_total);
  END IF;

  SELECT day, streak_day INTO v_last, v_streak
  FROM public.customer_checkins
  WHERE customer_id = v_customer
  ORDER BY day DESC LIMIT 1;

  v_done := (v_last = v_today);
  IF v_last IS NULL OR v_last < v_today - 1 THEN
    v_streak := 0;
  END IF;

  RETURN jsonb_build_object(
    'streak', coalesce(v_streak, 0),
    'checked_today', v_done,
    'next_day', CASE WHEN v_done THEN coalesce(v_streak, 1)
                     ELSE (coalesce(v_streak, 0) % 7) + 1 END,
    'global_total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkin_status(text, text) TO anon, authenticated;

-- Registra o check-in do dia e credita as moedas
CREATE OR REPLACE FUNCTION public.daily_checkin(p_device_id text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer uuid := public.resolve_customer(p_device_id, p_phone);
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_last date;
  v_streak integer := 0;
  v_day integer;
  v_coins integer;
  v_bonus integer := 0;
  v_seq bigint;
  v_balance integer;
BEGIN
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_customer');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sperb_checkin'));

  IF EXISTS (SELECT 1 FROM public.customer_checkins
              WHERE customer_id = v_customer AND day = v_today) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already');
  END IF;

  SELECT day, streak_day INTO v_last, v_streak
  FROM public.customer_checkins
  WHERE customer_id = v_customer
  ORDER BY day DESC LIMIT 1;

  IF v_last IS NULL OR v_last < v_today - 1 THEN
    v_streak := 0;
  END IF;

  v_day := (coalesce(v_streak, 0) % 7) + 1;
  v_coins := v_day;

  SELECT count(*) + 1 INTO v_seq FROM public.customer_checkins;
  IF v_seq % 100 = 0 THEN
    v_bonus := 1000;
  END IF;

  INSERT INTO public.customer_checkins (customer_id, day, streak_day, coins, bonus, global_seq)
  VALUES (v_customer, v_today, v_day, v_coins, v_bonus, v_seq);

  INSERT INTO public.customer_coin_ledger (customer_id, delta, reason)
  VALUES (v_customer, v_coins, 'Check-in diário (dia ' || v_day || ')');

  IF v_bonus > 0 THEN
    INSERT INTO public.customer_coin_ledger (customer_id, delta, reason)
    VALUES (v_customer, v_bonus, 'Prêmio do check-in de número ' || v_seq);
  END IF;

  SELECT coalesce(sum(delta), 0)::integer INTO v_balance
  FROM public.customer_coin_ledger WHERE customer_id = v_customer;

  RETURN jsonb_build_object(
    'ok', true, 'day', v_day, 'coins', v_coins, 'bonus', v_bonus,
    'global_seq', v_seq, 'balance', v_balance,
    'next_day', (v_day % 7) + 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.daily_checkin(text, text) TO anon, authenticated;