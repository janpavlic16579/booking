// Konfiguracija frontenda.
//
// API_BASE = naslov zalednega API-ja.
//   - Prazno ("")  → isti origin (lokalni razvoj ali celovit Render).
//   - Za GitHub Pages vpiši URL svojega Render API-ja, npr.:
//       window.API_BASE = "https://booking-nohti.onrender.com";
//
// POMEMBNO: brez poševnice na koncu.
//
// Render streže frontend in /api z istega strežnika, zato pustimo prazno
// (relativni klici na isti origin). Tako ni težav s CORS / "Failed to fetch".
window.API_BASE = "";
