# Stiliranje nohtov — spletna rezervacija

Preprosta spletna aplikacija, kjer:

- **stranke** vidijo proste termine in se rezervirajo (ime, telefon, e-pošta, opomba),
- **admin** odpira proste termine ter upravlja storitve in pregleduje rezervacije.

Brez build koraka. Tehnologija: Node.js + Express + vgrajen `node:sqlite`,
frontend je čist HTML/CSS/JS.

## Zahteve

- Node.js **22.5.0 ali novejši** (uporablja vgrajeni modul `node:sqlite`).

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
