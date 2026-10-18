#!/usr/bin/env python3
"""E2E algo marketplace: publik → creator → subscriber → webhook ingest → forward/slot.

Jalankan : python3 scripts/e2e-algo-test.py
           BASE=http://localhost:3000 python3 scripts/e2e-algo-test.py  (lokal)
Butuh    : SECRETS.md di root repo (gitignored; dibaca runtime, TIDAK di-commit).
Cakupan  : feed publik, CRUD algo/hook, subscribe free (instan), preflight bayar
           (402 tanpa dana), SSRF guard slot, limit slot, moderasi pesan, job
           algo_forward. TIDAK memindahkan dana on-chain.
"""
import json, base64, urllib.request, urllib.parse, urllib.error, re, sys, pathlib, os, time, random, string
ROOT = pathlib.Path(__file__).resolve().parents[1]
SECRETS = open(ROOT / "SECRETS.md").read()
def grab(pat):
    m = re.search(pat, SECRETS)
    return m.group(1) if m else ""
URL = grab(r"\| URL \| `([^`]+)`")
ANON = grab(r"\| Anon key[^|]*\| `([^`]+)`")
SR = grab(r"\| Service role key[^|]*\| `([^`]+)`")
ADMIN = "b02d2677-25e2-4e90-b45d-b224d7f3536a"
BASE = os.environ.get("BASE", "https://artian-capital-group.trading-ekaryan.workers.dev")

def http(url, method="GET", body=None, headers=None, raw=None):
    # Cloudflare Workers memblokir UA urllib (1010) → panggil via curl utk BASE
    if url.startswith(BASE):
        import subprocess
        args = ["curl", "-s", "-o", "-", "-w", "\n%{http_code}", "-X", method,
                "-H", "Content-Type: application/json"]
        for k, v in (headers or {}).items():
            if k != "Content-Type":
                args += ["-H", f"{k}: {v}"]
        if raw is not None:
            args += ["--data", raw]
        elif body is not None:
            args += ["--data", json.dumps(body)]
        args.append(url)
        out = subprocess.run(args, capture_output=True, text=True, timeout=90).stdout
        payload, _, code = out.rpartition("\n")
        return int(code), payload
    if raw is not None:
        data = raw.encode()
    else:
        data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def rest(path, method="GET", body=None):
    return http(f"{URL}/rest/v1/{path}", method, body,
                {"apikey": SR, "Authorization": f"Bearer {SR}"})

def session_for(email):
    _, gl = http(f"{URL}/auth/v1/admin/generate_link", "POST",
                 {"type": "magiclink", "email": email},
                 {"apikey": SR, "Authorization": f"Bearer {SR}"})
    action_link = json.loads(gl)["action_link"]
    import http.client as hc
    pu = urllib.parse.urlparse(action_link)
    conn = hc.HTTPSConnection(pu.netloc, timeout=30)
    conn.request("GET", pu.path + ("?" + pu.query if pu.query else ""))
    resp = conn.getresponse(); resp.read()
    loc = resp.getheader("Location") or ""
    tok = urllib.parse.parse_qs(urllib.parse.urlparse(loc).fragment)
    access, refresh = tok.get("access_token", [""])[0], tok.get("refresh_token", [""])[0]
    assert access and refresh, f"gagal ambil token: {loc[:80]}"
    _, user_json = http(f"{URL}/auth/v1/user", headers={"apikey": ANON, "Authorization": f"Bearer {access}"})
    session = {
        "access_token": access, "refresh_token": refresh, "token_type": "bearer",
        "expires_in": int(tok.get("expires_in", ["3600"])[0]),
        "expires_at": int(tok.get("expires_at", ["0"])[0]), "user": json.loads(user_json),
    }
    val = "base64-" + base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip("=")
    enc = urllib.parse.quote(val, safe="")
    if len(enc) <= 3180:
        cookie = f"sb-vysgkjqbmgbbowsxafok-auth-token={val}"
    else:
        parts = [enc[i:i+3180] for i in range(0, len(enc), 3180)]
        cookie = "; ".join(f"sb-vysgkjqbmgbbowsxafok-auth-token.{i}={p}" for i, p in enumerate(parts))
    return {"Cookie": cookie, "Content-Type": "application/json"}, session

results = []
def check(name, want, got, extra=""):
    ok = got == want
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: want={want} got={got} {extra}")

# ── 0. sesi admin ──────────────────────────────────────────────
_, users = http(f"{URL}/auth/v1/admin/users?page=1&per_page=5",
                headers={"apikey": SR, "Authorization": f"Bearer {SR}"})
email = next(u["email"] for u in json.loads(users)["users"] if u["id"] == ADMIN)
H, _ = session_for(email)
print(f"[sesi] admin={email[:3]}***")

# ── 1. publik ─────────────────────────────────────────────────
st, _ = http(f"{BASE}/algos")
check("GET /algos (publik)", 200, st)
st, body = http(f"{BASE}/api/algos")
data = json.loads(body) if body else {}
check("GET /api/algos (publik)", 200, st)
check("GET /api/algos items[]", True, isinstance(data.get("items"), list))
st, _ = http(f"{BASE}/api/algos")
check("POST /api/algos tanpa sesi → 401", 401, http(f"{BASE}/api/algos", "POST", {"name": "x"})[0])
st, _ = http(f"{BASE}/api/algos/00000000-0000-0000-0000-000000000000")
check("GET /api/algos/[id] tak dikenal → 404", 404, st)

# ── 2. jobs constraint algo_forward ───────────────────────────
st, body = http(f"{URL}/rest/v1/jobs", "POST", {"type": "algo_forward", "payload": {"smoke": True}},
                {"apikey": SR, "Authorization": f"Bearer {SR}", "Prefer": "return=minimal"})
check("insert jobs type=algo_forward (constraint)", 201, st)
if st == 201:
    # hapus baris smoke (id terakhir dari select)
    st2, ids = rest("jobs?select=id&payload=smoke.eq.true&order=id.desc&limit=1")
    if st2 == 200 and ids.strip() not in ("", "[]"):
        rid = json.loads(ids)[0]["id"]
        rest(f"jobs?id=eq.{rid}", "DELETE")

# ── 3. commission dari pricing_config (fallback 1 USDC) ───────
st, pbody = rest("pricing_config?select=key,value&key=eq.algo_commission")
commission = 1.0
if st == 200 and pbody.strip() not in ("", "[]"):
    commission = float(json.loads(pbody)[0]["value"].get("amount_usdc", 1))
print(f"[commission] {commission} USDC")

# ── 4. creator: algo paid + algo free ─────────────────────────
st, body = http(f"{BASE}/api/algos", "POST",
                {"name": "TEST Algo Paid", "description": "smoke", "priceUsdc": "6", "billing": "monthly"},
                H)
check("POST /api/algos (paid 6 USDC)", 201, st)
paid = json.loads(body) if st == 201 else {}
paid_id = paid.get("algo", {}).get("id", "")
paid_hook = paid.get("hook", {}).get("token", "")
check("algo paid + hook default", True, bool(paid_id and paid_hook))

half = commission / 2
half_s = f"{half:.6f}".rstrip("0").rstrip(".")
st, body = http(f"{BASE}/api/algos/{paid_id}", "PATCH", {"priceUsdc": half_s}, H)
check("PATCH harga ≤ komisi → 400", 400, st, extra=body[:80])
st, _ = http(f"{BASE}/api/algos/{paid_id}", "PATCH", {"priceUsdc": "7"}, H)
check("PATCH harga valid → 200", 200, st)

st, body = http(f"{BASE}/api/algos", "POST",
                {"name": "TEST Algo Free", "priceUsdc": "0"}, H)
check("POST /api/algos (free)", 201, st)
free = json.loads(body) if st == 201 else {}
free_id = free.get("algo", {}).get("id", "")
free_hook = free.get("hook", {}).get("token", "")
check("algo free + hook default", True, bool(free_id and free_hook))
check("free → billing lifetime", "lifetime", free.get("algo", {}).get("billing"))

# ── 5. hooks CRUD ─────────────────────────────────────────────
st, body = http(f"{BASE}/api/algos/{paid_id}/hooks", headers=H)
check("GET hooks → 1 default", 1, len(json.loads(body).get("hooks", [])) if st == 200 else -1)
st, body = http(f"{BASE}/api/algos/{paid_id}/hooks", "POST", {"label": "tv"}, H)
check("POST hook ke-2 → 201", 201, st)
hook2 = json.loads(body).get("hook", {}).get("id", "") if st == 201 else ""
st, _ = http(f"{BASE}/api/algos/{paid_id}/hooks/{hook2}", "DELETE", headers=H)
check("DELETE hook → 200", 200, st)

# ── 6. webhook ingest (valid/invalid) ─────────────────────────
st, body = http(f"{BASE}/api/algos/{paid_id}/hook/badsignal", "POST", {"message": "x"})
check("webhook token salah → 404", 404, st)
st, body = http(f"{BASE}/api/algos/{paid_id}/hook/{paid_hook}", "POST",
                {"title": "BTC long", "message": "entry 108k", "symbol": "BTCUSDT"},
                raw="bukan-json")
check("webhook body rusak → 400", 400, st)
st, body = http(f"{BASE}/api/algos/{paid_id}/hook/{paid_hook}", "POST",
                {"title": "BTC long", "message": "entry 108k", "symbol": "BTCUSDT"})
check("webhook valid → 202", 202, st, extra=body[:80])
msg_id = json.loads(body).get("id") if st == 202 else None
check("message id tersimpan", True, bool(msg_id))

# feed publik lihat message
st, body = http(f"{BASE}/api/algos/{paid_id}")
d = json.loads(body) if st == 200 else {}
check("GET feed publik (tanpa login) → 200", 200, st)
check("feed berisi message", 1, len(d.get("messages", [])) if st == 200 else -1)
check("text terekstrak", True, "entry 108k" in (d.get("messages", [{}])[0].get("text", "") if d.get("messages") else ""))
check("viewerIsOwner=false tanpa login", False, d.get("viewerIsOwner"))
st, _ = http(f"{BASE}/algos/{paid_id}")
check("GET /algos/[id] halaman → 200", 200, st)

# ── 7. owner gate: subscribe sendiri / slot tanpa sub ─────────
st, body = http(f"{BASE}/api/algos/{paid_id}/subscribe", "POST", headers=H)
check("subscribe algo sendiri → 400", 400, st)
st, body = http(f"{BASE}/api/algos/{paid_id}/slots", "POST", {"destUrl": "https://example.com/a"}, H)
check("slot tanpa langganan → 403", 403, st)

# ── 8. subscriber baru ────────────────────────────────────────
sub_email = f"algo-smoke-{int(time.time())}@example.com"
sub_pass = "Sm0ke-" + "".join(random.choices(string.ascii_letters + string.digits, k=10))
st, body = http(f"{URL}/auth/v1/admin/users", "POST",
                {"email": sub_email, "password": sub_pass, "email_confirm": True},
                {"apikey": SR, "Authorization": f"Bearer {SR}"})
check("buat user subscriber", 200, st)
sub_id = json.loads(body).get("id", "") if st in (200, 201) else ""
# bootstrap profile (FK) via service role
st, _ = rest("profiles", "POST", {"user_id": sub_id, "username": f"algotest{str(int(time.time()))[-8:]}"})
check("bootstrap profiles subscriber", 201, st)
HS, _ = session_for(sub_email)

# free subscribe instan
st, body = http(f"{BASE}/api/algos/{free_id}/subscribe", "POST", headers=HS)
check("subscribe free → 200 instan", 200, st, extra=body[:80])
check("subscribe free tanpa tx", True, (json.loads(body) or {}).get("free") if st == 200 else False)

# paid subscribe tanpa dana → 402 (preflight)
st, body = http(f"{BASE}/api/algos/{paid_id}/subscribe", "POST", headers=HS)
check("subscribe paid tanpa USDC → 402", 402, st, extra=body[:80])

# duplikat subscribe free → 409
st, _ = http(f"{BASE}/api/algos/{free_id}/subscribe", "POST", headers=HS)
check("subscribe ulang free → 409", 409, st)

# subscriber status di feed
st, body = http(f"{BASE}/api/algos/{free_id}", headers=HS)
d = json.loads(body) if st == 200 else {}
check("mySub.active=true setelah free", True, d.get("mySub", {}).get("active"))
check("mySlotCount=0", 0, d.get("mySlotCount"))

# ── 9. slots: SSRF guard + limit 3 ────────────────────────────
st, body = http(f"{BASE}/api/algos/{free_id}/slots", "POST", {"destUrl": "http://127.0.0.1:9/x"}, HS)
check("slot SSRF localhost → 400", 400, st, extra=body[:60])
st, body = http(f"{BASE}/api/algos/{free_id}/slots", "POST", {"destUrl": "ftp://x.com/a"}, HS)
check("slot non-http → 400", 400, st, extra=body[:60])
st, _ = http(f"{BASE}/api/algos/{free_id}/slots", "POST", {"destUrl": "https://example.com/hook1"}, HS)
check("slot #1 → 201", 201, st)
st, _ = http(f"{BASE}/api/algos/{free_id}/slots", "POST", {"destUrl": "https://example.com/hook2"}, HS)
check("slot #2 → 201", 201, st)
st, _ = http(f"{BASE}/api/algos/{free_id}/slots", "POST", {"destUrl": "https://example.com/hook3"}, HS)
check("slot #3 → 201", 201, st)
st, body = http(f"{BASE}/api/algos/{free_id}/slots", "POST", {"destUrl": "https://example.com/hook4"}, HS)
check("slot #4 (lewat limit) → 400", 400, st, extra=body[:60])

# ── 10. ingest ke free algo → forward + job retry ─────────────
st, body = http(f"{BASE}/api/algos/{free_id}/hook/{free_hook}", "POST",
                {"message": "ETH breakout", "symbol": "ETHUSDT"})
check("webhook free → 202", 202, st, extra=body[:80])
if st == 202:
    j = json.loads(body)
    check("forward inline: pending slot gagal → job", True, j.get("pending", 0) >= 1 or j.get("forwarded", 0) >= 1)
    time.sleep(1)
    st2, jbody = rest("jobs?select=id,type,status,payload&order=id.desc&limit=3")
    jobs = json.loads(jbody) if st2 == 200 else []
    fwd = [x for x in jobs if x.get("type") == "algo_forward"]
    check("job algo_forward terantri", True, len(fwd) >= 1)

# ── 11. moderasi pesan ────────────────────────────────────────
free_msg = None
st, body = http(f"{BASE}/api/algos/{free_id}", headers=HS)
if st == 200 and json.loads(body).get("messages"):
    free_msg = json.loads(body)["messages"][-1]["id"]
st, _ = http(f"{BASE}/api/algos/{free_id}/messages/{free_msg or 999999}", "DELETE", headers=HS)
check("hapus pesan bukan owner → 403", 403, st)
st, _ = http(f"{BASE}/api/algos/{paid_id}/messages/{msg_id or 999999}", "DELETE", headers=H)
check("hapus pesan oleh owner → 200", 200, st)

# nonaktifkan algo paid → ingest ditolak, feed 404 utk publik
st, _ = http(f"{BASE}/api/algos/{paid_id}", "PATCH", {"isActive": False}, H)
check("pause algo → 200", 200, st)
st, _ = http(f"{BASE}/api/algos/{paid_id}/hook/{paid_hook}", "POST", {"message": "x"})
check("webhook algo pause → 409", 409, st)
st, _ = http(f"{BASE}/api/algos/{paid_id}")
check("feed publik algo pause → 404", 404, st)
st, _ = http(f"{BASE}/api/algos/{paid_id}", headers=H)
check("feed owner tetap bisa lihat pause → 200", 200, st)

# ── 12. cleanup ───────────────────────────────────────────────
for aid in (paid_id, free_id):
    if aid:
        rest(f"algos?id=eq.{aid}", "DELETE")
if sub_id:
    http(f"{URL}/auth/v1/admin/users/{sub_id}", "DELETE", headers={"apikey": SR, "Authorization": f"Bearer {SR}"})
print("[cleanup] algos test + user subscriber dihapus")

# ── ringkasan ─────────────────────────────────────────────────
passed = sum(results)
total = len(results)
print(f"\n=== E2E algo: {passed}/{total} PASS ===")
if passed != total:
    sys.exit(1)
