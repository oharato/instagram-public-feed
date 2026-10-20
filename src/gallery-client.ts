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
  function show(value) {
    index = Math.max(0, Math.min(images.length - 1, value));
    images.forEach((image, position) => { image.hidden = position !== index; });
    images[index].loading = 'eager';
    previous.disabled = index === 0;
    next.disabled = index === images.length - 1;
    counter.textContent = (index + 1) + ' / ' + images.length;
  }
  previous.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  show(0);
}
`;

export const galleryScriptHash = `sha256-${createHash("sha256").update(galleryScript).digest("base64")}`;
