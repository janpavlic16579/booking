// Konfiguracija frontenda.
//
// API_BASE = naslov zalednega API-ja.
//   - Prazno ("")  → isti origin (npr. odpiranje strani neposredno na Render URL-ju).
//   - GitHub Pages / lastna domena (mia-booking.si) NIMA backenda, zato mora
//     kazati na Render API.
//
// POMEMBNO: brez poševnice na koncu.
//
// Stran teče na mia-booking.si (GitHub Pages, samo statične datoteke),
// backend pa na Renderju — zato kažemo na absolutni Render URL.
// Backend dovoli CORS z vseh originov (avtentikacija je žeton, ne piškotek),
// zato čezizvorni klici delujejo.
// Lokalni razvoj (npm start na localhost) uporablja lokalni backend, da testne
// rezervacije ne pristanejo v produkcijski bazi.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
window.API_BASE = LOCAL_HOSTS.includes(location.hostname)
  ? ""
  : "https://booking-2kn2.onrender.com";

