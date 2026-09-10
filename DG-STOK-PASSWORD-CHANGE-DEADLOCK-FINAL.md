# DG STOK — ADMIN PASSWORD CHANGE DEADLOCK — KÖK NEDEN + RED TEAM

Tarih: 2026-08-16 · Production: `http://localhost:4001`

---

## KÖK NEDEN

`/auth/change-password` endpoint'i **ZATEN doğruydu** ve `mustChangePassword` kilidinden ETKİLENMİYORDU (kendi token doğrulamasını yapar, `requireAuth` kullanmaz). Ölü kilit şu zincirde oluşuyordu:

```
Sayfa yenileniyor / mevcut geçerli cookie ile açılıyor
   ↓
checkAuth() → GET /auth/me → 200  (ESKİ davranış: mustChangePassword bilgisini DÖNDÜRMÜYORDU)
   ↓
loadApp() çalışıyor
   ↓
Tüm requireAuth'lı API'ler (dashboard/products/marketplaces/settings...) → 403 "Password change required"
   ↓
Kullanıcı şifre değiştirme ekranına yönlendirilmiyor → kilitli (deadlock)
```

Yani şifre değiştirme ekranı yalnızca `doLogin()` akışında (`res.mustChangePassword` görülünce) açılıyordu. Kullanıcı bir kez giriş yapıp çerezle kaldığında, sayfa yenilendiğinde `/auth/me` 200 dönüyor (mustChangePassword bildirmiyordu), `checkAuth()` doğrudan `loadApp()` çağırıyor ve kullanıcı 403'lerle kırık bir dashboard'da kilitli kalıyordu.

**Kesin cevap:** Evet, `mustChangePassword=true` olan kullanıcının parolasını değiştirmesine izin veren özel endpoint VAR ([`/auth/change-password`](server/src/server.ts:202)) ve bu endpoint 403 ile ENGELLENMİYORDU. Sorun, frontend'in bu ekranı **sayfa yenilendiğinde** gösterememesiydi.

---

## AFFECTED FILES

- [`server/src/server.ts`](server/src/server.ts:187) — `/auth/me` yanıtına `mustChangePassword` eklendi.
- [`index.html`](index.html:2573) — `checkAuth()` `mustChangePassword=true` durumunda `loadApp()` yerine şifre değişikliği ekranını açıyor.

---

## FIX

1. `/auth/me` artık `{ id, email, role, name, mustChangePassword }` döndürür (preferences parse edilir, fail-closed korunur).
2. `checkAuth()` → `mustChangePassword=true` ise `showChangePassword()` çağırır; uygulama 403'lü duruma hiç girmez.
3. Güvenlik davranışı DEĞİŞMEDİ: normal API'ler kilitli kalır, `/auth/change-password` yalnızca kendi hesabı + geçerli mevcut parola + yeni parola kuralları ile izinlidir.

---

## TEST SONUÇLARI (geçici test kullanıcıları, gerçek admin'e DOKUNULMADI)

| Test | Sonuç |
|---|---|
| A) login → `mustChangePassword=true` | ✅ PASS |
| B) eski parola + yeni güçlü parola → change 2xx | ✅ PASS (200 `password_changed`) |
| C) change sonrası `mustChangePassword=false` | ✅ PASS |
| D) yeni parola ile login | ✅ PASS (200) |
| E) eski parola ile login | ✅ PASS (401 FAIL) |
| F) change endpoint auth olmadan | ✅ PASS (401) |
| G) başka kullanıcının parolası değiştirilemez | ✅ PASS (yalnız token sahibi kendi hesabını değiştirir) |
| H) `mustChangePassword=true` iken normal API'ler | ✅ PASS (403) |
| I) `mustChangePassword=true` iken kendi change endpoint'i | ✅ PASS (200) |
| J) Browser: LOGIN → PASSWORD CHANGE → SAVE → re-LOGIN → DASHBOARD | ✅ PASS (5/5 adım) |

- Browser: Page error = **0**, login sonrası 4xx/5xx = **0**. Console'da yalnızca giriş öncesi beklenen `/auth/me` 401 (2 kez, normal boot kontrolü).

---

## PASSWORD CHANGE DEADLOCK

```
ROOT CAUSE = /auth/me mustChangePassword bilgisini döndürmüyordu; checkAuth() sayfa
             yenilendiğinde şifre değişikliği ekranını göstermiyor, kullanıcı 403'lerle kilitli kalıyordu.
AFFECTED FILES = server/src/server.ts (auth/me), index.html (checkAuth)
FIX = /auth/me mustChangePassword döndürür; checkAuth() mustChangePassword=true iken
      şifre değişikliği ekranını açar. Güvenlik kilidi ve password-change endpoint'i DEĞİŞMEDİ.

AUTH SECURITY = PASS
PASSWORD CHANGE = PASS
MUST_CHANGE_FLOW = PASS
BROWSER = PASS
NETWORK = PASS
CONSOLE = PASS
TSC = PASS
BUILD = PASS
REGRESSION = PASS

REAL ADMIN DATA CHANGED = NO
SCHEMA CHANGED = NO
DB RESET = NO
SEED = NO

FAIL COUNT = 0

FINAL = PASS
```

> Gerçek admin hesabı (`admin@dgstok.com`) READ-ONLY doğrulandı: `role=ADMIN`, `mustChangePassword=true` — **başlangıç durumuyla aynı, parola değiştirilmedi.** Kullanıcı uygulamaya girdiğinde artık şifre değişikliği ekranı otomatik açılır; güçlü parola belirledikten sonra `mustChangePassword=false` olur ve tüm modüller açılır.
