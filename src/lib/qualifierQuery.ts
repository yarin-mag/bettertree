/**
 * Tokenizes a GitHub-search-qualifier-style query string ("key:value" tokens
 * separated by spaces, with quoted values allowed for spaces inside a value)
 * so dropdown filters and free text can share one query box, same as
 * github.com's own search bar.
 */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const regex = /[^\s"]+:"[^"]*"|"[^"]*"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query))) {
    tokens.push(match[0]);
  }
  return tokens;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteIfNeeded(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

/** Returns the current value of `key:...` in `query`, or undefined if absent. */
export function getQualifier(query: string, key: string): string | undefined {
  const prefix = `${key}:`;
  for (const token of tokenize(query)) {
    if (token.startsWith(prefix)) {
      return unquote(token.slice(prefix.length));
    }
  }
  return undefined;
}

/**
 * Returns `query` with `key:value` upserted (replacing any existing
 * `key:...` token), or with the `key:...` token removed if `value` is null.
 */
export function setQualifier(query: string, key: string, value: string | null): string {
  const prefix = `${key}:`;
  const tokens = tokenize(query);
  const existingIndex = tokens.findIndex((token) => token.startsWith(prefix));

  if (value === null) {
    if (existingIndex !== -1) tokens.splice(existingIndex, 1);
    return tokens.join(" ");
  }

  const newToken = `${prefix}${quoteIfNeeded(value)}`;
  if (existingIndex !== -1) {
    tokens[existingIndex] = newToken;
  } else {
    tokens.push(newToken);
  }
  return tokens.join(" ");
}
