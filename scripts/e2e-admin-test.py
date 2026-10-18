#!/usr/bin/env python3
"""E2E admin test: sesi via magiclink -> cookie SSR -> endpoint wallet/treasury.

Jalankan : python3 scripts/e2e-admin-test.py
           BASE=http://localhost:3000 python3 scripts/e2e-admin-test.py  (lokal)
Butuh    : SECRETS.md di root repo (gitignored; dibaca runtime, TIDAK di-commit).
Cakupan  : baca terautentikasi + kasus negatif (validasi/tolak). TIDAK memindahkan
           dana; micro-transfer hanya jalan bila saldo wallet admin > 0.
"""
import json, base64, urllib.request, urllib.parse, urllib.error, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
SECRETS = open(ROOT / "SECRETS.md").read()
def grab(pat):
    m = re.search(pat, SECRETS)
    return m.group(1) if m else ""
URL = grab(r"\| URL \| `([^`]+)`")
ANON = grab(r"\| Anon key[^|]*\| `([^`]+)`")
SR = grab(r"\| Service role key[^|]*\| `([^`]+)`")
ADMIN = "b02d2677-25e2-4e90-b45d-b224d7f3536a"
import os
BASE = os.environ.get("BASE", "https://artian-capital-group.trading-ekaryan.workers.dev")

def http(url, method="GET", body=None, headers=None, return_headers=False):
    # Cloudflare Workers memblokir UA urllib (1010) → panggil via curl utk BASE
    if url.startswith(BASE):
        import subprocess, tempfile, os
        args = ["curl", "-s", "-o", "-", "-w", "\n%{http_code}", "-X", method,
                "-H", "Content-Type: application/json"]
        for k, v in (headers or {}).items():
            if k != "Content-Type":
                args += ["-H", f"{k}: {v}"]
        if body is not None:
            args += ["--data", json.dumps(body)]
        args.append(url)
        out = subprocess.run(args, capture_output=True, text=True, timeout=90).stdout
        payload, _, code = out.rpartition("\n")
        if return_headers:
            return int(code), payload, {}
        return int(code), payload
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return (r.status, raw, r.headers) if return_headers else (r.status, raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return (e.code, raw, e.headers) if return_headers else (e.code, raw)

# ── 1. sesi admin ──────────────────────────────────────────────
_, users = http(f"{URL}/auth/v1/admin/users?page=1&per_page=5",
                headers={"apikey": SR, "Authorization": f"Bearer {SR}"})
email = next(u["email"] for u in json.loads(users)["users"] if u["id"] == ADMIN)
_, gl = http(f"{URL}/auth/v1/admin/generate_link", "POST",
             {"type": "magiclink", "email": email},
             {"apikey": SR, "Authorization": f"Bearer {SR}"})
action_link = json.loads(gl)["action_link"]
# GET manual (tanpa auto-follow): token magiclink satu kali, ambil Location ber-fragment
import http.client as hc
pu = urllib.parse.urlparse(action_link)
conn = hc.HTTPSConnection(pu.netloc, timeout=30)
conn.request("GET", pu.path + ("?" + pu.query if pu.query else ""))
resp = conn.getresponse(); resp.read()
loc = resp.getheader("Location") or ""
frag = urllib.parse.urlparse(loc).fragment
tok = urllib.parse.parse_qs(frag)
access, refresh = tok.get("access_token", [""])[0], tok.get("refresh_token", [""])[0]
assert access and refresh, f"gagal ambil token: {loc[:80]}"
_, user_json = http(f"{URL}/auth/v1/user", headers={"apikey": ANON, "Authorization": f"Bearer {access}"})
user = json.loads(user_json)
session = {
    "access_token": access, "refresh_token": refresh, "token_type": "bearer",
    "expires_in": int(tok.get("expires_in", ["3600"])[0]),
    "expires_at": int(tok.get("expires_at", ["0"])[0]), "user": user,
}
val = "base64-" + base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip("=")
# chunking ala ssr bila > 3180
enc = urllib.parse.quote(val, safe="")
if len(enc) <= 3180:
    cookie = f"sb-vysgkjqbmgbbowsxafok-auth-token={val}"
else:
    parts = [enc[i:i+3180] for i in range(0, len(enc), 3180)]
    cookie = "; ".join(f"sb-vysgkjqbmgbbowsxafok-auth-token.{i}={p}" for i, p in enumerate(parts))
H = {"Cookie": cookie, "Content-Type": "application/json"}
print(f"[sesi] user={user.get('email','')[:3]}*** expires_at={session['expires_at']} cookie_len={len(cookie)}")

results = []
def check(name, want, got, extra=""):
    ok = got == want
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: want={want} got={got} {extra}")

# ── 2. baca terautentikasi ─────────────────────────────────────
st, body = http(f"{BASE}/api/wallet", headers=H)
d = json.loads(body) if st == 200 else {}
check("GET /api/wallet", 200, st)
wallets = d.get("wallets", [])
archived_ids = [w["id"] for w in wallets if w.get("archived_at")]
check("wallet non-arsip saja di daftar", 0, len(archived_ids))
active_id = d.get("activeId")
print(f"       wallets aktif: {len(wallets)}, activeId={active_id}")

st, body = http(f"{BASE}/api/wallet/balance", headers=H)
check("GET /api/wallet/balance", 200, st)

st, body = http(f"{BASE}/api/admin/treasury", headers=H)
check("GET /api/admin/treasury", 200, st)
tre = json.loads(body) if st == 200 else {}
print(f"       treasury: {tre.get('sol')} SOL / {tre.get('usdc')} USDC | wallet admin: "
      f"{(tre.get('wallet') or {}).get('sol')} SOL / {(tre.get('wallet') or {}).get('usdc')} USDC")

# ── 3. negatif: arsip/switch ───────────────────────────────────
# archived ids di-query dari DB (bukan hardcode) agar skrip tahan perubahan data
_, wrows = http(f"{URL}/rest/v1/wallets?select=id,archived_at&user_id=eq.{ADMIN}",
                headers={"apikey": SR, "Authorization": f"Bearer {SR}"})
archived_ids = [r["id"] for r in json.loads(wrows) if r["archived_at"]]
assert archived_ids, "butuh minimal 1 wallet terarsip utk uji negatif arsip-ulang"
st, body = http(f"{BASE}/api/wallet/active", "POST", {"walletId": archived_ids[0]}, H)
check("switch ke wallet terarsip → 404", 404, st)

st, body = http(f"{BASE}/api/wallet/{active_id}", "DELETE", headers=H)
check("arsip wallet AKTIF → 409", 409, st)
print(f"       msg: {body[:90]}")

st, body = http(f"{BASE}/api/wallet/{archived_ids[1]}", "DELETE", headers=H)
check("arsip ulang wallet terarsip → 409", 409, st)

# verifikasi wallet aktif TIDAK berubah oleh upaya DELETE di atas
st, body = http(f"{BASE}/api/wallet", headers=H)
d2 = json.loads(body)
ids_now = {w["id"] for w in d2["wallets"]}
check("wallet aktif tetap non-arsip setelah DELETE 409", True, active_id in ids_now)

# ── 4. negatif: treasury validation ────────────────────────────
st, body = http(f"{BASE}/api/admin/treasury", "POST",
                {"action": "deposit", "asset": "usdc", "amount": "abc"}, H)
check("treasury amount non-numerik → 400", 400, st)

st, body = http(f"{BASE}/api/admin/treasury", "POST",
                {"action": "deposit", "asset": "usdc", "amount": "0"}, H)
check("treasury amount 0 → 400", 400, st)

wbal = tre.get("wallet") or {}
# jumlah di atas saldo wallet admin tapi di bawah cap → 400 insufficient (tanpa mutasi)
too_much = f"{float(wbal.get('usdc', 0)) + 1000:.2f}"
if float(too_much) <= 50_000:
    st, body = http(f"{BASE}/api/admin/treasury", "POST",
                    {"action": "deposit", "asset": "usdc", "amount": too_much}, H)
    check("deposit melebihi saldo → 400 (tanpa transfer)", 400, st)
    print(f"       msg: {json.loads(body).get('error','')[:80]}")

st, body = http(f"{BASE}/api/admin/treasury", "POST",
                {"action": "deposit", "asset": "usdc", "amount": "1"}, {"Cookie": cookie.replace("sb-", "sb-x-"), "Content-Type": "application/json"})
check("POST treasury non-admin/invalid sesi → 403/401", True, st in (401, 403))

# ── 5. micro-transfer nyata (bila saldo cukup) ─────────────────
w_usdc = float(wbal.get("usdc", 0)); w_sol = float(wbal.get("sol", 0))
t_sol = float(tre.get("sol", 0)); t_usdc = float(tre.get("usdc", 0))
if w_usdc >= 0.05 and w_sol >= 0.012:
    st, body = http(f"{BASE}/api/admin/treasury", "POST",
                    {"action": "deposit", "asset": "usdc", "amount": "0.05"}, H)
    ok = st == 200
    print(f"{'PASS' if ok else 'FAIL'}  LIVE deposit 0.05 USDC: {st} {body[:120]}")
    results.append(ok)
    if ok and t_sol >= 0.011:  # withdraw butuh gas treasury
        sig = json.loads(body).get("sig")
        st, body = http(f"{BASE}/api/admin/treasury", "POST",
                        {"action": "withdraw", "asset": "usdc", "amount": "0.05"}, H)
        ok = st == 200
        print(f"{'PASS' if ok else 'FAIL'}  LIVE withdraw 0.05 USDC: {st} {body[:120]}")
        results.append(ok)
    elif t_sol < 0.011:
        st, body = http(f"{BASE}/api/admin/treasury", "POST",
                        {"action": "withdraw", "asset": "usdc", "amount": "0.05"}, H)
        msg = json.loads(body).get("error", "")
        ok = st == 400 and "SOL" in msg and "deposit SOL" in msg
        print(f"{'PASS' if ok else 'FAIL'}  withdraw dgn treasury SOL tipis → 400 pesan jelas: {st} {msg[:80]}")
        results.append(ok)
else:
    print(f"SKIP  micro-transfer (wallet admin: {w_usdc} USDC / {w_sol} SOL; butuh ≥0.05 USDC & ≥0.012 SOL)")

print(f"\n=== {sum(results)}/{len(results)} PASS ===")
sys.exit(0 if all(results) else 1)
