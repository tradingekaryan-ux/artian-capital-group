-- ============================================================
-- 0010 — webhook alert (5 slot konfigurasi admin):
--   * webhook_alert     — satu pengiriman POST ke URL slot
--                         (event baru, transaksi, wallet, algo, user)
--   * user_alert_scan   — job siklis tiap pass cron: deteksi user baru
--                         via GoTrue admin API (registrasi lewat GoTrue
--                         langsung — tidak ada hook server saat signUp)
-- Config URL disimpan di pricing_config (key webhook_events/tx/wallet/algo/user)
-- dengan value {"url": "..."} — tidak perlu kolom baru.
-- ============================================================

alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('create_token','create_pool','add_liquidity','remove_liquidity',
                  'withdraw','swap','index_wallet','price_snapshot','treasury_rebalance','refund',
                  'algo_forward','webhook_alert','user_alert_scan'));
