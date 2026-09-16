import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { requestCommand, shellQuote, tokenCommand, uploadCommand } from '../../src/lib/microcks/curl';
import { fixture } from './support';

/** Runs a command line in bash with `curl` swapped for a function echoing its standard input: what it would send. */
const runWithFakeCurl = (command: string): string =>
  execFileSync('bash', ['-c', `curl() { cat; }\n${command}`], { encoding: 'utf8' });

describe('shellQuote', () => {
  it('survives the shell whatever the value holds', () => {
    const value = `it's "quoted" $HOME \`x\` \\ ;`;
    expect(execFileSync('bash', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' })).toBe(value);
  });
});

describe('uploadCommand', () => {
  it('sends the artifact exactly as it is, under its name', () => {
    const { content } = fixture('petshop-examples.yaml');
    const command = uploadCommand('http://mk/api/artifact/upload?mainArtifact=false', 'petshop-examples.yaml', content, false);
    expect(runWithFakeCurl(command)).toBe(content);
    expect(command.split('\n')[0]).toBe(
      `curl -sS -X POST 'http://mk/api/artifact/upload?mainArtifact=false' -F 'file=@-;filename="petshop-examples.yaml"' <<'ARTIFACT'`,
    );
  });

  it('picks a here-document delimiter the artifact does not contain', () => {
    const content = 'openapi: 3.0.0\nARTIFACT\n';
    expect(runWithFakeCurl(uploadCommand('http://mk/u', 'odd.yaml', content, false))).toBe(content);
  });

  it('reads the token from the environment, never inline', () => {
    const command = uploadCommand('http://mk/u', 'a.json', '{}', true);
    expect(command).toContain(`-H "Authorization: Bearer $MICROCKS_TOKEN"`);
  });
});

describe('requestCommand and tokenCommand', () => {
  it('writes GET plainly and other methods explicitly', () => {
    expect(requestCommand('GET', 'http://mk/api/services?page=0&size=1000', false)).toBe(
      `curl -sS 'http://mk/api/services?page=0&size=1000'`,
    );
    expect(requestCommand('DELETE', 'http://mk/api/services/abc', true)).toBe(
      `curl -sS -X DELETE -H "Authorization: Bearer $MICROCKS_TOKEN" 'http://mk/api/services/abc'`,
    );
  });

  it('exports a token obtained with credentials from the environment', () => {
    expect(tokenCommand('http://kc/realms/microcks/protocol/openid-connect/token')).toBe(
      `export MICROCKS_TOKEN=$(curl -sS -u "$MICROCKS_CLIENT_ID:$MICROCKS_CLIENT_SECRET" -d grant_type=client_credentials ` +
        `'http://kc/realms/microcks/protocol/openid-connect/token' | jq -r .access_token)`,
    );
  });
});
