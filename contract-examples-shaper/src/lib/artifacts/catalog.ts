import { matchOperation, readBodyFile, toApiExamples, versionMatches, type BodyFile, type MatchedBodyFile } from './body-files';
import { parseArtifact } from './parse';
import { serviceId, type ParsedArtifact, type ServiceRef, type SourceFile } from './types';

export interface CatalogExample {
  operation: string;
  example: string;
  /** Path of the file the example is declared in. The same example name may come from several files. */
  path: string;
}

export interface CatalogOperation {
  name: string;
  examples: CatalogExample[];
}

export interface Contract {
  /** `name:version`, as Microcks identifies a service. */
  id: string;
  service: ServiceRef;
  /** The artifact that creates the service, if the sources hold one. */
  primary?: ParsedArtifact;
  /** Primary first, then example-bearing secondaries, then metadata: the order they must be imported in. */
  files: ParsedArtifact[];
  operations: CatalogOperation[];
  warnings: string[];
}

export interface Catalog {
  contracts: Contract[];
  /** Recognized, but naming a service only Microcks can tell (gRPC, SoapUI): they load as whole files. */
  unidentified: ParsedArtifact[];
  /**
   * Recognized, but naming no service where one is required. Never offered for loading: Microcks would accept an
   * OpenAPI without `info` and create a service named `:`.
   */
  invalid: ParsedArtifact[];
  /** Files Microcks would not know what to do with: READMEs, schemas pulled in by `$ref`... */
  unrecognized: SourceFile[];
}

const importOrder = (a: ParsedArtifact): number =>
  a.role === 'primary' ? 0 : a.kind === 'apimetadata' ? 2 : 1;

export function buildCatalog(files: SourceFile[]): Catalog {
  const byService = new Map<string, ParsedArtifact[]>();
  const unidentified: ParsedArtifact[] = [];
  const invalid: ParsedArtifact[] = [];
  const unrecognized: SourceFile[] = [];
  const bodies: BodyFile[] = [];

  for (const file of files) {
    const artifact = parseArtifact(file);
    if (!artifact) {
      // Microcks reads none of these; one whose path says what it answers is an example's body (see body-files.ts).
      const body = readBodyFile(file);
      if (body) bodies.push(body);
      else unrecognized.push(file);
    } else if (!artifact.service) (artifact.kind === 'grpc' || artifact.kind === 'soapui' ? unidentified : invalid).push(artifact);
    else byService.set(serviceId(artifact.service), [...(byService.get(serviceId(artifact.service)) ?? []), artifact]);
  }

  const claimed = new Set<BodyFile>();
  const contracts = [...byService.entries()].map(([id, artifacts]) => {
    const service = artifacts[0].service!;
    const mine = bodies.filter((body) => versionMatches(service, body.version));
    mine.forEach((body) => claimed.add(body));
    return toContract(id, [...artifacts, ...bodyFileArtifacts(service, artifacts, mine)]);
  });
  contracts.sort((a, b) => a.id.localeCompare(b.id));

  // A body file whose version names no contract of the sources is a file like any other Microcks cannot read.
  unrecognized.push(...bodies.filter((body) => !claimed.has(body)).map((body) => body.file));
  return { contracts, unidentified, invalid, unrecognized };
}

/**
 * The body files of a service as one APIExamples artifact, ready to load like any other companion. A file whose URI
 * calls no declared operation is left out: Microcks would drop its example without a word.
 */
function bodyFileArtifacts(service: ServiceRef, artifacts: ParsedArtifact[], bodies: BodyFile[]): ParsedArtifact[] {
  if (bodies.length === 0) return [];
  const declared = artifacts.find((a) => a.role === 'primary' && a.operations.length > 0)?.operations ?? [];
  const kept: MatchedBodyFile[] = [];
  const left: string[] = [];
  for (const body of bodies) {
    const match = declared.length === 0 ? undefined : matchOperation(declared, body.uri);
    if (match) kept.push({ ...body, ...match });
    else left.push(`${body.file.path}: ${declared.length === 0 ? 'the sources hold no contract declaring the operations' : `no GET of the contract answers ${body.uri}`}, so it is left out.`);
  }
  if (kept.length === 0) return [];

  const artifact = parseArtifact(toApiExamples(service, kept));
  if (!artifact) return [];
  artifact.warnings.push(
    `Built from ${kept.length} file${kept.length === 1 ? '' : 's'} whose path says what they answer.`,
    ...left,
    ...sameRequestWarnings(kept),
  );
  return [artifact];
}

/** Body files say nothing about the request beyond its URI, so several of one URI all answer the same call. */
function sameRequestWarnings(bodies: MatchedBodyFile[]): string[] {
  const byUri = new Map<string, MatchedBodyFile[]>();
  bodies.forEach((body) => byUri.set(body.uri, [...(byUri.get(body.uri) ?? []), body]));
  return [...byUri.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([uri, group]) => `${group.map((body) => body.example).join(', ')} all answer GET ${uri}: Microcks serves one of them.`);
}

function toContract(id: string, artifacts: ParsedArtifact[]): Contract {
  const warnings: string[] = [];

  // One artifact creates the service. A Postman collection next to a contract is its companion; a second contract
  // for the same service is imported as secondary too, which is how Microcks merges several files' examples.
  const candidates = artifacts.filter((a) => a.role === 'primary');
  const primary = candidates.find((a) => a.kind !== 'postman' && a.kind !== 'postman-workspace') ?? candidates[0];
  for (const other of candidates) {
    if (other === primary) continue;
    other.role = 'secondary';
    if (other.kind !== 'postman' && other.kind !== 'postman-workspace') {
      warnings.push(`${other.file.path} also defines ${id}; it will be imported as a secondary artifact.`);
    }
  }
  if (!primary) {
    warnings.push(`No contract for ${id} in the sources: its files can only be loaded onto a service already in Microcks.`);
  }

  const names = new Map<string, string>();
  for (const artifact of artifacts) {
    const previous = names.get(artifact.file.name);
    if (previous) {
      warnings.push(`${previous} and ${artifact.file.path} share the name ${artifact.file.name}: Microcks cannot tell them apart.`);
    }
    names.set(artifact.file.name, artifact.file.path);
  }

  const files = [...artifacts].sort((a, b) => importOrder(a) - importOrder(b) || a.file.path.localeCompare(b.file.path));

  const operations = new Map<string, CatalogExample[]>();
  for (const artifact of files) {
    for (const ref of artifact.examples) {
      operations.set(ref.operation, [...(operations.get(ref.operation) ?? []), { ...ref, path: artifact.file.path }]);
    }
  }

  return {
    id,
    service: primary?.service ?? artifacts[0].service!,
    primary,
    files,
    operations: [...operations.entries()].map(([name, examples]) => ({ name, examples })),
    warnings,
  };
}
