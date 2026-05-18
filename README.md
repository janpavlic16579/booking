# Stiliranje nohtov — spletna rezervacija

Preprosta spletna aplikacija, kjer:

- **stranke** vidijo proste termine in se rezervirajo (ime, telefon, e-pošta, opomba),
- **admin** odpira proste termine ter upravlja storitve in pregleduje rezervacije.

Brez build koraka. Tehnologija: Node.js + Express + vgrajen `node:sqlite`,
frontend je čist HTML/CSS/JS.

## Zahteve

- Node.js **22.13.0 ali novejši** (uporablja vgrajeni modul `node:sqlite`).

## Namestitev in zagon

```bash
npm install
cp .env.example .env      # po želji prilagodi vrednosti
npm start
```

Strežnik privzeto teče na <http://localhost:3000>.

- Stranke: <http://localhost:3000/>
- Skrbniški del: <http://localhost:3000/admin>

## Konfiguracija (`.env`)

| Spremenljivka       | Privzeto             | Opis                                  |
| ------------------- | -------------------- | ------------------------------------- |
| `PORT`              | `3000`               | Vrata strežnika.                      |
| `ADMIN_PASSWORD`    | `admin`              | Geslo za skrbniško prijavo.           |
| `DB_PATH`           | `./data/booking.db`  | Pot do SQLite baze.                   |
| `SESSION_TTL_HOURS` | `12`                 | Trajanje skrbniške seje (ure).        |

> **Pomembno:** v produkciji obvezno nastavi svoj `ADMIN_PASSWORD`.

## Uporaba

### Admin

1. Odpri `/admin` in se prijavi z geslom (`ADMIN_PASSWORD`).
2. **Storitve** — dodaj/uredi storitve (ime, trajanje, cena). Ob prvem zagonu so
   pripravljene tri privzete storitve (Manikira, Gel lak, Podaljševanje nohtov).
3. **Termini** — izberi storitev in datum, dodaj eno ali več ur in odpri proste
   termine. Konec termina se izračuna iz trajanja storitve.
4. **Rezervacije** — pregled vseh rezervacij s podatki strank.

### Stranka

1. Odpri `/`, po želji filtriraj po storitvi.
2. Klikni prosti termin, vnesi ime, telefon in e-pošto ter potrdi rezervacijo.

## Podatki

SQLite baza se ustvari samodejno v `data/` (ni v gitu). Za ponovni začetek
preprosto izbriši datoteko baze.

## Testi

```bash
npm test
```

Zažene smoke test, ki preveri celoten tok (prijava, storitev, termin,
rezervacija, preprečitev dvojne rezervacije, zaščita admin poti).

## Objava na splet (Render)

Repo vsebuje `render.yaml`, zato je objava preprosta:

1. Ustvari račun na <https://render.com> in poveži svoj GitHub.
2. **New > Web Service** (ali **Blueprint**) → izberi repo `janpavlic16579/booking`
   in vejo `claude/review-booking-repo-834MU`.
3. Render samodejno zazna nastavitve (Node, `npm install`, `npm start`,
   health check `/health`).
4. Med ustvarjanjem vnesi okoljsko spremenljivko **`ADMIN_PASSWORD`**
   (tvoje skrbniško geslo).
5. Klikni **Create** — po nekaj minutah dobiš javni URL
   (npr. `https://booking-nohti.onrender.com`).
   - Stranke: `/`
   - Admin: `/admin`

### Trajnost podatkov

Brezplačni Render načrt ima **začasen disk** — baza (rezervacije) se izbriše
ob vsakem ponovnem zagonu/objavi/mirovanju. Primerno za ogled in testiranje.

Za **prave rezervacije strank** uporabi trajni disk (v `render.yaml` so
zakomentirana navodila): nastavi `plan: starter`, odkomentiraj sekcijo `disk`
in spremenljivko `DB_PATH=/var/data/booking.db`.

## GitHub Pages (lastna domena) + ločen API na Render

GitHub Pages streže samo statične datoteke, zato gre tja **samo frontend**
(mapa `public/`), zaledni API (Express + baza) pa teče ločeno na Render.
Frontend kliče API prek `window.API_BASE` (CORS je na zaledju že urejen).

**1. Zaledje (API) na Render**

- Objavi prek `render.yaml` (glej zgoraj). Dobiš npr.
  `https://booking-nohti.onrender.com`.
- Na Render dodaj okoljsko spremenljivko:
  `ALLOWED_ORIGINS=https://tvoja-domena.si,https://www.tvoja-domena.si`

**2. Frontend → kam naj kliče API**

- V `public/config.js` nastavi:
  `window.API_BASE = "https://booking-nohti.onrender.com";` (brez `/` na koncu).
- Commitaj in pushaj na vejo `claude/review-booking-repo-834MU`
  (sproži se workflow `.github/workflows/pages.yml`).

**3. Vklop GitHub Pages**

- Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
- Repo mora biti **javen** (brezplačen Pages) ali imeti GitHub Pro.
- Workflow objavi vsebino mape `public/` ob vsakem pushu na vejo.

**4. Lastna domena**

- Preimenuj `public/CNAME.example` → `public/CNAME` in vpiši svojo domeno
  (npr. `www.tvoja-domena.si`), commitaj. (Lahko tudi samo:
  Settings → Pages → Custom domain.)
- **DNS pri domenca.com:**
  - apex `tvoja-domena.si` — štirje **A** zapisi:
    `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
  - `www` — **CNAME** → `janpavlic16579.github.io`
- Ko DNS propagira (lahko nekaj ur), v Settings → Pages vključi
  **Enforce HTTPS**.

Rezultat: stran na `https://tvoja-domena.si`, klici na
`https://booking-nohti.onrender.com`. Brez CORS napak, ker je `ALLOWED_ORIGINS`
na Render nastavljen na tvojo domeno.
