-- Default pricing (semua nilai dalam USDC, raw base unit 6 desimal)
insert into public.pricing_config (key, value) values
  ('create_token',  '{"amount_usdc": 2,  "label": "Create token"}'),
  ('create_pool',   '{"amount_usdc": 10, "label": "Create liquidity pool"}'),
  ('add_liquidity', '{"amount_usdc": 1,  "label": "Add liquidity"}'),
  ('remove_liquidity', '{"amount_usdc": 0, "label": "Remove liquidity"}'),
  ('swap',          '{"percent": 0.30, "min_usdc": 0.05, "label": "In-app swap"}'),
  ('withdraw',      '{"flat_usdc": 0.5, "min_usdc": 1, "max_daily_usdc": 50000, "label": "USDC withdrawal"}'),
  ('treasury',      '{"gas_sol_warn": 0.3, "gas_sol_target": 1.0, "label": "Treasury gas"}')
on conflict (key) do nothing;
