// Small UI helpers shared by pages. Kept separate from lib/config.ts to avoid merge conflicts.

/** Shown instead of a broken image when a run photo can't be loaded (e.g. not signed in). */
export const PHOTO_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#e7f6ec"/>' +
      '<rect x="21" y="29" width="22" height="17" rx="3" fill="none" stroke="#7fb894" stroke-width="3"/>' +
      '<path d="M25 29v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#7fb894" stroke-width="3"/></svg>'
  );

/** onError handler: swap a failed photo for the placeholder (once). */
export function photoFallback(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  if (img.src !== PHOTO_PLACEHOLDER) {
    img.src = PHOTO_PLACEHOLDER;
    img.title = "Sign in as a runner in this challenge to see photos";
  }
}
