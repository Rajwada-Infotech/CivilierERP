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

/**
 * Wrapper marking a string as already-trusted HTML so `safeHtml` leaves it
 * un-escaped. Use ONLY for markup you built yourself (pre-rendered table
 * rows, a controlled `<img>` tag, another `safeHtml` result) — never for
 * raw user/DB values.
 */
export class RawHtml {
  constructor(readonly value: string) {}
}

export const raw = (value: string): RawHtml => new RawHtml(value);

/**
 * Tagged-template that HTML-escapes every interpolated value by default, so a
 * print/preview window built with `document.write(safeHtml\`…\`)` cannot be
 * broken out of by user/DB data. Wrap intentional HTML fragments in `raw()`.
 *
 *   document.write(safeHtml`<h2>${record.Name}</h2>${raw(rowsHtml)}`)
 */
export function safeHtml(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  return strings.reduce((out, str, i) => {
    if (i >= values.length) return out + str;
    const v = values[i];
    return out + str + (v instanceof RawHtml ? v.value : escapeHtml(v));
  }, "");
}
