// Tiny i18n — two plain dictionaries + a t(key) lookup, no react-i18next. The
// UI language lives in settingsStore (`language`). High-traffic shell strings are
// converted first (header, tabs, summary, add bar); the long tail stays English
// until translated — t() falls back to the English string, then to the key, so a
// missing translation degrades gracefully rather than showing a blank.
//
// Keys are dot-namespaced (e.g. 'summary.marketValue'). Interpolation: pass a
// vars object and use {name} placeholders — t('x.y', { n: 3 }).
import { useSettingsStore } from '../store/settingsStore.js';

const en = {
  'nav.portfolio': 'Portfolio',
  'nav.plan': 'Plan',
  'nav.forecast': 'Forecast',

  'header.tagline': 'Multi-asset portfolio dashboard',
  'header.live': 'Live',
  'header.offline': 'Offline',
  'header.reconnecting': 'Reconnecting…',
  'header.waking': 'Free server is waking up — live data in ~30s…',
  'header.language': 'Language',

  'add.quickAdd': 'Quick add:',
  'add.searchPlaceholder': 'Search stocks, crypto, gold...  (e.g. AAPL, bitcoin, PTT.BK)',
  'add.added': 'added',
  'add.already': 'Already in portfolio',

  'summary.marketValue': 'Market Value',
  'summary.totalPL': 'Total P/L',
  'summary.todaysChange': "Today's Change",
  'summary.annualDividends': 'Annual Dividends',
  'summary.dividendsReceived': 'Dividends Received',
  'summary.realizedPL': 'Realized P/L',
  'summary.cost': 'Cost',
  'summary.fromSells': 'from recorded sells',
  'summary.loggedNetWht': 'logged, net of withholding',
  'summary.yield': '{pct}% yield',

  'holdings.title': 'Holdings ({n})',
  'holdings.sort.added': 'Added',
  'holdings.sort.value': 'Value',
  'holdings.sort.day': 'Day %',
  'holdings.sort.pl': 'P&L',
  'holdings.sort.symbol': 'Symbol',
};

const th = {
  'nav.portfolio': 'พอร์ต',
  'nav.plan': 'วางแผน',
  'nav.forecast': 'พยากรณ์',

  'header.tagline': 'แดชบอร์ดพอร์ตการลงทุนหลายสินทรัพย์',
  'header.live': 'เรียลไทม์',
  'header.offline': 'ออฟไลน์',
  'header.reconnecting': 'กำลังเชื่อมต่อใหม่…',
  'header.waking': 'เซิร์ฟเวอร์ฟรีกำลังตื่น — ข้อมูลสดในอีก ~30 วินาที…',
  'header.language': 'ภาษา',

  'add.quickAdd': 'เพิ่มด่วน:',
  'add.searchPlaceholder': 'ค้นหาหุ้น คริปโท ทองคำ...  (เช่น AAPL, bitcoin, PTT.BK)',
  'add.added': 'เพิ่มแล้ว',
  'add.already': 'มีในพอร์ตแล้ว',

  'summary.marketValue': 'มูลค่าตลาด',
  'summary.totalPL': 'กำไร/ขาดทุนรวม',
  'summary.todaysChange': 'เปลี่ยนแปลงวันนี้',
  'summary.annualDividends': 'เงินปันผลต่อปี',
  'summary.dividendsReceived': 'เงินปันผลที่ได้รับ',
  'summary.realizedPL': 'กำไร/ขาดทุนที่รับรู้',
  'summary.cost': 'ต้นทุน',
  'summary.fromSells': 'จากการขายที่บันทึกไว้',
  'summary.loggedNetWht': 'บันทึกไว้ สุทธิหลังหักภาษี ณ ที่จ่าย',
  'summary.yield': 'ผลตอบแทน {pct}%',

  'holdings.title': 'สินทรัพย์ ({n})',
  'holdings.sort.added': 'เพิ่มเมื่อ',
  'holdings.sort.value': 'มูลค่า',
  'holdings.sort.day': '% วัน',
  'holdings.sort.pl': 'กำไร/ขาดทุน',
  'holdings.sort.symbol': 'สัญลักษณ์',
};

const DICTS = { en, th };

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Translate a key for a given language. Falls back English -> key.
 * @param {string} key
 * @param {'en'|'th'} lang
 * @param {Record<string, any>} [vars]
 */
export function translate(key, lang, vars) {
  const dict = DICTS[lang] || en;
  const s = dict[key] != null ? dict[key] : en[key] != null ? en[key] : key;
  return interpolate(s, vars);
}

/**
 * Hook: returns a `t(key, vars)` bound to the current UI language, so components
 * re-render when the language toggles.
 */
export function useT() {
  const lang = useSettingsStore((s) => s.language) || 'en';
  return (key, vars) => translate(key, lang, vars);
}

export default { translate, useT };
