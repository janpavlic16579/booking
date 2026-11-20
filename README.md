# Stiliranje nohtov — spletna rezervacija

Preprosta spletna aplikacija, kjer:

- **stranke** vidijo proste termine in se rezervirajo (ime, telefon, e-pošta, opomba),
- **admin** odpira proste termine ter upravlja storitve in pregleduje rezervacije.

Brez build koraka. Tehnologija: Node.js + Express + Postgres (Neon v produkciji,
vgrajeni PGlite lokalno), frontend je čist HTML/CSS/JS.

## Zahteve

- Node.js **24**.

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

| Spremenljivka       | Privzeto          | Opis                                                          |
| ------------------- | ----------------- | ------------------------------------------------------------- |
| `PORT`              | `3000`            | Vrata strežnika (lokalno).                                    |
| `ADMIN_PASSWORD`    | `Marjetka123`     | Geslo za skrbniško prijavo.                                   |
| `DATABASE_URL`      | —                 | Neon Postgres (pooled povezava). Brez nje se uporabi PGlite.  |
| `PGLITE_DIR`        | `./data/pglite`   | Mapa lokalne baze PGlite (samo brez `DATABASE_URL`).          |
| `SESSION_TTL_HOURS` | `12`              | Trajanje skrbniške seje (ure).                                |

> **Pomembno:** v produkciji obvezno nastavi svoj `ADMIN_PASSWORD`. Sprememba
> gesla odjavi vse admin seje.

## Uporaba

### Admin

1. Odpri `/admin` in se prijavi z geslom (`ADMIN_PASSWORD`).
2. **Storitve** — dodaj/uredi storitve (ime, trajanje, cena). Ob prvem zagonu so
   pripravljenih osem privzetih storitev.
3. **Termini** — izberi storitev in datum, dodaj eno ali več ur in odpri proste
   termine. Konec termina se izračuna iz trajanja storitve.
4. **Rezervacije** — pregled vseh rezervacij s podatki strank.

### Stranka

1. Odpri `/`, po želji filtriraj po storitvi.
2. Klikni prosti termin, vnesi ime, telefon in e-pošto ter potrdi rezervacijo.

## Podatki

Shema in 8 privzetih storitev se ustvarijo samodejno ob prvem zagonu.
Lokalno baza živi v `data/pglite/` (ni v gitu); za ponovni začetek izbriši to
mapo. V produkciji so podatki v Neonu.

## Testi

```bash
npm test
```

Zažene smoke test, ki preveri celoten tok (prijava, storitev, termin,
rezervacija, preprečitev dvojne rezervacije, zaščita admin poti).

## Objava na Vercel

Frontend in API tečeta skupaj na Vercelu, podatki so v Neon Postgresu.

1. Na <https://vercel.com> izberi **Add New > Project** in uvozi repo
   `janpavlic16579/booking` (produkcijska veja: `claude/review-booking-repo-834MU`).
2. V projektu odpri **Storage**, ustvari **Neon** bazo in jo poveži s projektom.
   Vercel doda spremenljivko `DATABASE_URL`.
3. V **Settings > Environment Variables** dodaj `ADMIN_PASSWORD` (svoje geslo).
4. **Deploy.** Tabele in 8 privzetih storitev se ustvarijo ob prvem klicu API-ja.
5. V **Settings > Domains** dodaj `mia-booking.si` in pri domenca.com popravi
   DNS zapise po navodilih Vercela (apex A zapis, `www` CNAME).
6. Ko domena deluje, izbriši servis na Renderju in izklopi GitHub Pages
   (repo **Settings > Pages**).
