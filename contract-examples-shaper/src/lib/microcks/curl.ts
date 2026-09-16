/**
 * Shell command lines equivalent to the calls the client makes, for the journal. They are meant to be pasted into
 * a POSIX shell and run as they are: credentials never appear, they are read from environment variables instead.
 */

/** Quotes a value for a POSIX shell. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** The token obtained by the command {@link tokenCommand} prints. */
export const TOKEN_VARIABLE = 'MICROCKS_TOKEN';

const authHeader = (authenticated: boolean): string[] =>
  authenticated ? [`-H "Authorization: Bearer $${TOKEN_VARIABLE}"`] : [];

export function requestCommand(method: string, url: string, authenticated: boolean): string {
  return ['curl -sS', ...(method === 'GET' ? [] : [`-X ${method}`]), ...authHeader(authenticated), shellQuote(url)].join(' ');
}

/**
 * An upload with the artifact inline, as a here-document, so that a filtered artifact (which exists nowhere on disk)
 * can be imported again as it was. The multipart filename is what Microcks names the artifact after.
 */
export function uploadCommand(url: string, artifactName: string, content: string, authenticated: boolean): string {
  let delimiter = 'ARTIFACT';
  const lines = new Set(content.split(/\r?\n/));
  while (lines.has(delimiter)) delimiter += '_END';
  const filename = artifactName.replace(/["\\]/g, '\\$&');
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return [
    ['curl -sS -X POST', ...authHeader(authenticated), shellQuote(url), '-F', shellQuote(`file=@-;filename="${filename}"`), `<<'${delimiter}'`].join(' '),
    `${body}${delimiter}`,
  ].join('\n');
}

/** Client credentials read from the environment; the command exports the token the following commands use. */
export function tokenCommand(tokenUrl: string): string {
  return (
    `export ${TOKEN_VARIABLE}=$(curl -sS -u "$MICROCKS_CLIENT_ID:$MICROCKS_CLIENT_SECRET" ` +
    `-d grant_type=client_credentials ${shellQuote(tokenUrl)} | jq -r .access_token)`
  );
}
