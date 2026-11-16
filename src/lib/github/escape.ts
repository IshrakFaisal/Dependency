import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";

/** Inert inline code: every punctuation character is an entity, including
 * backticks, HTML delimiters, ampersands, mention markers and URL separators.
 * The fixed code element also excludes GitHub's mention/reference autolinking.
 * Newlines and controls cannot introduce a Markdown block or a table row.
 */
export function escapeCommentText(value: string): string {
  const text = value
    .normalize("NFKC")
    .replace(/[\p{Cf}]/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replaceAll(TRIAGE_DISCLAIMER, "[disclaimer omitted]")
    .replace(/\b(?:safe|unsafe|malicious|clean|verified)\b/gi, "[omitted]")
    .replace(
      /\b(?:risk[\s_-]*score)\b["']?\s*(?:[=:]|is)?\s*["']?[-+]?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/gi,
      "[score omitted]",
    );
  const escaped = Array.from(text, (character) =>
    /^[A-Za-z0-9 ]$/.test(character)
      ? character
      : `&#${character.codePointAt(0)};`,
  ).join("");
  return `<code>${escaped}</code>`;
}
