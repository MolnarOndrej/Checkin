const maxTitleCharacters = 32;
const titleSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function setDialogTitle(heading, title) {
  const characters = Array.from(titleSegmenter.segment(title), ({ segment }) => segment);
  const truncated = characters.length > maxTitleCharacters;
  heading.textContent = truncated ? `${characters.slice(0, maxTitleCharacters - 1).join('')}…` : title;
  heading.title = title;
  if (truncated) heading.setAttribute('aria-label', title);
  else heading.removeAttribute('aria-label');
}
