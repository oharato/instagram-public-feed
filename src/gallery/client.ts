import { createHash } from "node:crypto";

// Fixed script only; post text and other user content are never interpolated here.
export const galleryScript = `
for (const media of document.querySelectorAll('.media')) {
  const images = [...media.querySelectorAll('.images img')];
  const previous = media.querySelector('[data-previous]');
  const next = media.querySelector('[data-next]');
  const counter = media.querySelector('output');
  if (!previous || !next || !counter) continue;
  let index = 0;
  function show(value, activate = false) {
    index = Math.max(0, Math.min(images.length - 1, value));
    images.forEach((image, position) => { image.hidden = position !== index; });
    if (activate) images[index].loading = 'eager';
    previous.disabled = index === 0;
    next.disabled = index === images.length - 1;
    counter.textContent = (index + 1) + ' / ' + images.length;
  }
  previous.addEventListener('click', () => show(index - 1, true));
  next.addEventListener('click', () => show(index + 1, true));
  show(0);
}

const search = document.querySelector('#post-search');
const accountButtons = [...document.querySelectorAll('[data-account-filter]')];
const cards = [...document.querySelectorAll('article[data-account]')];
const resultCount = document.querySelector('#result-count');
const empty = document.querySelector('#no-results');
const reset = document.querySelector('[data-reset-filters]');
const formatNumber = new Intl.NumberFormat('ja-JP');
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja-JP');
const index = new Map(cards.map(card => [card, normalize(card.dataset.account + ' ' +
  (card.querySelector('.caption')?.textContent || card.querySelector('.post-title')?.textContent || ''))]));
let selectedAccount = '';

function applyFilters(syncUrl = true) {
  if (!search || !resultCount || !empty) return;
  const words = normalize(search.value.trim()).split(/\\s+/).filter(Boolean);
  let shown = 0;
  for (const card of cards) {
    const matches = (!selectedAccount || card.dataset.account === selectedAccount) &&
      words.every(word => index.get(card).includes(word));
    card.hidden = !matches;
    if (matches) shown++;
  }
  for (const button of accountButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.accountFilter === selectedAccount));
  }
  resultCount.textContent = formatNumber.format(shown) + '件';
  empty.hidden = shown !== 0;
  if (syncUrl) {
    try {
      const url = new URL(location.href);
      selectedAccount ? url.searchParams.set('account', selectedAccount) : url.searchParams.delete('account');
      search.value.trim() ? url.searchParams.set('q', search.value.trim()) : url.searchParams.delete('q');
      history.replaceState(null, '', url);
    } catch { /* Local files can still be searched when URL updates are unavailable. */ }
  }
}

function restoreFilters() {
  if (!search) return;
  const params = new URL(location.href).searchParams;
  const requested = params.get('account') || '';
  selectedAccount = accountButtons.some(button => button.dataset.accountFilter === requested) ? requested : '';
  search.value = params.get('q') || '';
  applyFilters(false);
}

for (const button of accountButtons) button.addEventListener('click', () => {
  selectedAccount = button.dataset.accountFilter;
  applyFilters();
});
search?.addEventListener('input', () => applyFilters());
search?.form?.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
reset?.addEventListener('click', () => {
  selectedAccount = '';
  if (search) search.value = '';
  applyFilters();
  search?.focus();
});
window.addEventListener('popstate', restoreFilters);
restoreFilters();
`;

export const galleryScriptHash = `sha256-${createHash("sha256").update(galleryScript).digest("base64")}`;
