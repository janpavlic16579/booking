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
window.API_BASE = "https://booking-nohti.onrender.com";

