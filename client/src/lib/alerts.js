// Price-alert evaluation — pure functions.
// Alert kinds:
//   'above' — live price >= value
//   'below' — live price <= value
//   'move'  — |day change %| >= value (either direction)

/**
 * @param {{kind:string, value:number, enabled?:boolean, triggeredAt?:string}} alert
 * @param {{price?:number, changePct?:number}|null} quote
 * @returns {boolean} true when the alert's condition is met right now
 */
export function evaluateAlert(alert, quote) {
  if (!alert || alert.enabled === false || alert.triggeredAt) return false;
  if (!quote) return false;
  const value = Number(alert.value);
  if (!Number.isFinite(value)) return false;
  const price = Number(quote.price);
  const changePct = Number(quote.changePct);
  switch (alert.kind) {
    case 'above':
      return Number.isFinite(price) && price >= value;
    case 'below':
      return Number.isFinite(price) && value > 0 && price <= value;
    case 'move':
      return Number.isFinite(changePct) && value > 0 && Math.abs(changePct) >= value;
    default:
      return false;
  }
}

/** Human description of an alert, for lists and notifications. */
export function describeAlert(alert) {
  if (!alert) return '';
  const v = Number(alert.value);
  switch (alert.kind) {
    case 'above':
      return `${alert.symbol} ≥ ${v}`;
    case 'below':
      return `${alert.symbol} ≤ ${v}`;
    case 'move':
      return `${alert.symbol} moves ±${v}% in a day`;
    default:
      return alert.symbol || '';
  }
}

export default { evaluateAlert, describeAlert };
