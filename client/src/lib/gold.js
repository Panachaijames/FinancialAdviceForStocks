// Thai gold ("บาททอง") unit math. Thai gold shops sell by baht-weight: 1 baht
// of gold = 15.244 g of 96.5%-pure gold. The world spot price (XAU) is quoted in
// USD per TROY OUNCE (31.1035 g) of PURE gold, so one baht-weight contains
// (15.244 / 31.1035) × 0.965 troy oz of pure gold ≈ 0.47289 oz.
//
// The app stores gold holdings canonically in troy oz + USD/oz (so the whole
// valuation pipeline is unchanged); these helpers convert to/from baht-weight
// for entry + display, and derive the live Thai shop price.

export const BAHT_WEIGHT_G = 15.244;
export const TROY_OZ_G = 31.1035;
export const GOLD_PURITY = 0.965; // 96.5% — Thai gold-bar standard
// Pure-gold troy ounces in one baht-weight of 96.5% gold.
export const OZ_PER_BAHT = (BAHT_WEIGHT_G / TROY_OZ_G) * GOLD_PURITY;

/** Baht-weight → canonical troy oz (of pure gold). */
export function bahtToOz(baht) {
  const n = Number(baht);
  return Number.isFinite(n) ? n * OZ_PER_BAHT : 0;
}

/** Canonical troy oz → baht-weight. */
export function ozToBaht(oz) {
  const n = Number(oz);
  return Number.isFinite(n) && OZ_PER_BAHT > 0 ? n / OZ_PER_BAHT : 0;
}

/**
 * THB price of one baht-weight of 96.5% gold from the USD/oz spot + USD→THB rate.
 * = XAUUSD × USDTHB × (15.244 / 31.1035) × 0.965. Also used to render a stored
 * USD/oz avg cost back as THB-per-baht. Returns 0 on bad inputs.
 */
export function bahtPriceThb(usdPerOz, usdThb) {
  const x = Number(usdPerOz);
  const r = Number(usdThb);
  if (!(x > 0) || !(r > 0)) return 0;
  return x * r * OZ_PER_BAHT;
}

/** THB-per-baht cost → canonical USD-per-oz avg cost (inverse of bahtPriceThb). */
export function thbPerBahtToUsdPerOz(thbPerBaht, usdThb) {
  const c = Number(thbPerBaht);
  const r = Number(usdThb);
  if (!(c > 0) || !(r > 0) || !(OZ_PER_BAHT > 0)) return 0;
  return c / r / OZ_PER_BAHT;
}

export default { OZ_PER_BAHT, bahtToOz, ozToBaht, bahtPriceThb, thbPerBahtToUsdPerOz };
