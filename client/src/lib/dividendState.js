// Distinguishes a FAILED dividend fetch from a confirmed "no dividend". The old
// code stored both as null, so a single 429 at startup pinned a confident
// "0.00" for the whole session and never retried. A failed fetch now stores
// DIVIDEND_ERROR, which callers render as "—" (unknown, not zero) and refetch
// when the connection recovers.
export const DIVIDEND_ERROR = Object.freeze({ __divError: true });

/** True for the failed-fetch sentinel (never for a real dividend or null). */
export const isDividendError = (d) => d === DIVIDEND_ERROR || !!(d && d.__divError);

export default { DIVIDEND_ERROR, isDividendError };
