/**
 * Turn a machine name (camelCase / snake_case / kebab-case) into a readable
 * Title Case label — `getBurnRate` → `Get Burn Rate`, `get_user_data` →
 * `Get User Data`, so tool names in the event stream stay scannable at a
 * glance.
 *
 * Deliberately conservative: names that already read as prose (a space, a
 * slash, a colon — e.g. `POST /api/chat`, `db.query`) are returned untouched so
 * we don't mangle span/operation names that are already human-friendly.
 */
export function humanizeName(name: string | undefined | null): string {
  if (!name) return '';
  // Already prose-like or a structured identifier (spaces, path/namespace
  // separators like `/`, `:`, `.`) — leave it alone.
  if (/[\s/:.]/.test(name)) return name;

  const spaced = name
    // snake_case / kebab-case → spaces
    .replace(/[_-]+/g, ' ')
    // camelCase / PascalCase boundaries → spaces
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // ACRONYMFollowedByWord → ACRONYM Word
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();

  if (!spaced.includes(' ') && spaced === name) {
    // Single lowercase token with no boundaries (e.g. `search`) — just cap it.
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  return spaced
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      // Preserve all-caps acronyms (API, URL); title-case everything else.
      word.length > 1 && word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}
