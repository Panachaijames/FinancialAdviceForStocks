// Scroll a holding's asset card into view and briefly highlight it. Used by the
// "View" action on the "Added X" / "Promoted X" snackbars. No-op if the card
// isn't mounted (e.g. still below a lazy boundary).
export function scrollToCard(symbol) {
  if (!symbol) return;
  const el = document.getElementById(`card-${symbol}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('card-flash');
  setTimeout(() => el.classList.remove('card-flash'), 1400);
}

export default scrollToCard;
