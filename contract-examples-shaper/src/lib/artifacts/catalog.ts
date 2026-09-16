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

  for (const file of files) {
    const artifact = parseArtifact(file);
    if (!artifact) unrecognized.push(file);
    else if (!artifact.service) (artifact.kind === 'grpc' || artifact.kind === 'soapui' ? unidentified : invalid).push(artifact);
    else byService.set(serviceId(artifact.service), [...(byService.get(serviceId(artifact.service)) ?? []), artifact]);
  }

  const contracts = [...byService.entries()].map(([id, artifacts]) => toContract(id, artifacts));
  contracts.sort((a, b) => a.id.localeCompare(b.id));
  return { contracts, unidentified, invalid, unrecognized };
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
