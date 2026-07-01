/**
 * HTML-escape a value for safe interpolation into markup that is written to
 * the DOM (e.g. `window.open()` + `document.write`, template strings assigned
 * to innerHTML). Covers the five characters that can break out of HTML text
 * or a double/single-quoted attribute context.
 *
 * Use this anywhere untrusted/user-controlled data (filenames, names, remarks)
 * is placed into a raw HTML string. Without it, e.g. an uploaded attachment
 * named `x</title><script>…</script>.png` executes script in the opened
 * same-origin window and can read the auth token from localStorage.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
