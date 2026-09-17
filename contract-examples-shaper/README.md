# Contract Examples Shaper

A web UI for shaping what a running Microcks mocks, in two activities:

- **Browse & load.** You pick contracts, examples and metadata from a folder or from URLs. The shaper groups the
  examples under the contract they belong to, next to what Microcks holds, and you load or unload any part of it: a
  whole contract, one file, or a single example.
- **Design.** You design examples for the operations of an OpenAPI contract, checked against its schemas, then
  package the ones you pick as an APIExamples file per contract and download it.

- Astro 7 (server output, Node adapter) with a React island
- Artifacts are parsed in the browser; the Astro server only talks to Microcks and fetches URLs
- Works with an unauthenticated Microcks (`microcks-uber`) and with a Keycloak-secured one

## Run it

Node 22.12 or later (`.nvmrc` says 24).

```bash
docker run -d -p 8585:8080 quay.io/microcks/microcks-uber:latest   # or any Microcks you have
cp .env.example .env                                              # MICROCKS_URL defaults to http://localhost:8585
npm install
npm run dev                                                       # http://localhost:4321
```

For a Microcks with authentication, set `MICROCKS_CLIENT_ID` and `MICROCKS_CLIENT_SECRET` to a Keycloak service
account with the `manager` role. The app detects authentication through `/api/keycloak/config`, as the Microcks CLI
does, and gets a client-credentials token server side, so the secret never reaches the browser. When the Keycloak URL
Microcks advertises is only reachable from inside its own network, override it with `MICROCKS_KEYCLOAK_URL`.

`npm run build && npm start` runs the production server.

## Using it

1. **Sources.** Choose a folder (read in the browser; build output and dot-folders are skipped), individual files,
   or paste raw file URLs (fetched by the server, since most hosts refuse cross-origin reads). Sources add up; picking
   a file again replaces it.
2. **Contracts.** One tree for the sources and Microcks together: each service (`name:version`) appears once, whether
   the sources define it, Microcks holds it, or both. Under it, *Files* lists the contract, its companions (APIExamples,
   Postman collections, extra contracts), its metadata, and any artifact Microcks imported that the sources lack.
   *Examples by operation* merges the examples of every file under the operation Microcks serves them for. Every item
   is marked:
   - **loaded**: in the sources and in Microcks, imported from that very file;
   - **ready to load**: in the sources, not (yet) in Microcks;
   - **only in Microcks**: imported from a file the sources don't hold, or no longer in the file that was imported.

   *Preview* on an example shows it as an exchange: the request line, headers and body, then the response status,
   headers and body (or the message of an event), with the example's summary. An example ready to load is read from
   its source file; one only in Microcks from what Microcks holds, including the dispatch criteria it matches requests
   on. A loaded example has both tabs, to check that what's served is what the file declares.

   The tabs *All*, *Ready to load* and *Loaded* (everything Microcks holds) narrow the tree, and a service or
   operation checkbox selects only what the tab shows: tick a service under *Ready to load* to load all of what's
   missing, under *Loaded* to take out all of what's there.
3. **Load or unload.** Tick anything, then *Load selected…* or *Unload selected…*. Loading skips what is already
   loaded; unloading skips what is only ready to load. The steps are listed before anything happens; *Apply* runs
   them one by one.
4. **Console.** At the bottom, every call the server made to Microcks and Keycloak: when, what for, the HTTP status,
   how long it took and what came back, with a *Copy* button for the equivalent command line. *Only changes* hides the
   reads. The journal lives in the server process (the last 200 calls) and is shared by every open tab.

### Console commands

The commands are `curl` lines meant to be pasted into a shell as they are:

- An import carries the artifact inline, as a here-document, under the filename Microcks names it after. A filtered
  artifact exists nowhere on disk, so this is the only way to replay exactly what was sent.
- No credential is ever written out. With authentication, the token call reads `MICROCKS_CLIENT_ID` and
  `MICROCKS_CLIENT_SECRET` from the environment and exports `MICROCKS_TOKEN` (it needs `jq`); the calls after it send
  `Authorization: Bearer $MICROCKS_TOKEN`. The token is cached, so its call only shows up when a new one is fetched.

## Designing examples

*Design* (or `#design` in the URL) works on the OpenAPI 3.0 and 3.1 contracts of the sources; the sources are shared
with *Browse & load*.

1. **Pick an operation.** Operations are listed per contract, with how many drafts and how many examples of the
   sources each has.
2. **Design.** *+ New example* starts a draft from the contract: required path, query and header parameters, a request
   body and a response body sampled from the schemas (their `example`, `default` or first `enum` value when they have
   one), and the first success status. Edit it field by field; *Fill from schema* and *Format* help with bodies.
   *Duplicate* starts a variant. *Preview* shows the draft as the exchange it describes and as the APIExamples it
   packages into; the examples the sources already hold for the operation can be previewed too. Drafts are saved in the browser (IndexedDB) as you type, and are there on your next
   visit.
3. **Check.** Each field shows what's wrong with it. Only what makes an example unusable is an error and keeps the draft
   out of a package: no name, a name used twice for the operation, a missing path parameter (Microcks builds the mock's
   path from it), a status that isn't one, a body that isn't JSON. What the contract's schemas reject is a warning: an
   example of a `400` is meant to carry a request the contract refuses. So is a name the sources already use for the
   operation.
4. **Package and export.** Tick drafts, adjust the file name if needed (default `<name>-<version>-examples.yaml`),
   *Preview*, then *Download*: one YAML for one contract, a `.zip` of one YAML per contract otherwise. Or *Add to
   sources*: the package joins the sources as `designed/<file name>`, a companion of its contract whose examples are
   ready to load in *Browse & load*. Adding again replaces it; so does a file of the contract with the same name
   already in the sources (only in the sources: the file on disk is untouched). Like every source, it lasts until the
   page is reloaded; the drafts stay.

A package is an [APIExamples](https://microcks.io/documentation/references/examples/) document: a secondary
artifact that leaves the contract untouched. Path and query parameters go under `request.parameters`, where Microcks
tells them apart by the `{name}` placeholders of the operation; header parameters go under `request.headers`, with
`Content-Type` and `Accept` from the media types; JSON bodies are written as YAML structures. Before a package is handed
out it is read back with the same rules as any source file, and must hold exactly the drafts picked.

A package named like a companion of the contract replaces that companion's examples when loaded into Microcks; the
package panel says so. Examples of packages added to the sources don't count as clashing with the drafts they were
made from.

## How loading and unloading work

Microcks has no endpoint to remove one example. It does, however, store every example with the name of the artifact
it came from: the multipart filename of the upload. It replaces exactly those examples when an artifact with the same
name is imported again (`ServiceService.updateArtifactMessages`). The shaper builds on that:

| You select, then…                     | The shaper                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| load examples of a contract not in Microcks | uploads the contract with only those examples, as main artifact, then the companions |
| load or unload some examples of a file | uploads that file again, under the same name, holding the examples to keep  |
| unload everything Microcks holds of a contract it was created from | deletes the service, and says so if that takes examples the sources lack |
| unload a service only in Microcks     | deletes the service (its examples can't be picked without their files)         |
| load metadata                         | uploads the APIMetadata file last                                            |
| unload metadata                       | re-imports the contract as it is loaded, then re-applies the metadata that stays |

Some Microcks behaviours shape the order of the steps:

- **A companion for a service that doesn't exist is dropped silently**, and the upload still answers 201. So the
  contract always goes first, and when a step fails the rest of that contract's steps are skipped.
- **Importing a contract again resets dispatchers** set by APIMetadata, so loaded metadata is applied again after it.
  Microcks doesn't report which metadata was applied, so the browser remembers that (in `localStorage`), as it does
  for companions without examples, such as a Postman collection holding only test scripts.
- **Microcks picks an importer from the text of the file** (`MockRepositoryImporterFactory`): `kind: APIExamples` has
  to be a YAML line, `"_postman_id":` has to start a line. A filtered file is written back in its original format,
  pretty-printed, and checked to still read as the same kind.
- **Microcks accepts a contract with no `info`** and creates a service named `:`. Such files are listed as *Cannot be
  loaded*.

### What can be picked one by one

| Kind                         | Examples picked one by one                              | Named after                          |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------ |
| OpenAPI 3.x                  | yes: named `examples` of response content               | `info.title` / `info.version`        |
| AsyncAPI 2 / 3               | yes, when every example has a `name`                    | `info.title` / `info.version`        |
| Postman collection           | yes: saved responses                                    | `info.name` + `version=` in description |
| APIExamples                  | yes                                                     | `metadata.name` / `metadata.version` |
| APIMetadata                  | — (applied or not)                                      | `metadata.name` / `metadata.version` |
| Swagger 2, GraphQL, HAR      | whole file                                              | `info`, or a `microcksId:` comment    |
| gRPC, SoapUI                 | whole file; the service is named by Microcks on import  | —                                    |

A filtered OpenAPI keeps request bodies and parameter examples as they are: Microcks only builds a message from a
response example, so an orphaned request example is ignored. Response and message components shared between
operations are copied into each operation before filtering, so trimming one operation never trims another. AsyncAPI 3
operations have to reference channel messages, so a message shared by several operations keeps an example while any
of them keeps it.

### Known limits

- Contracts whose `$ref`s point at other files can't have those references resolved once uploaded alone; they are
  flagged. Bundle them first.
- The artifact name is the file name, not its path: two files named `examples.yaml` for the same service clash, and
  are flagged. A URL source is named after the last segment of its path.
- A companion that loads as a whole file (e.g. a Postman collection holding only test scripts) can't be unloaded on
  its own: unload the whole contract instead.
- Re-uploading a filtered file drops YAML comments.

## Tests

```bash
npm test          # 117 unit tests: detection, extraction, filtering, catalog, plan, view, client, journal, commands,
                  # design (operations, schema sampling and validation, drafts, packaging, zip, draft stores),
                  # previews (OpenAPI, APIExamples, AsyncAPI, Postman, drafts, Microcks), components
npm run test:it   # a real microcks-uber via Testcontainers: load all, unload one example, load it back,
                  # preview what Microcks serves against the file, replay journaled commands with curl, show an
                  # example only Microcks holds, delete;
                  # design examples for a contract without any, package, load, and call the mocks
```

The unit tests use `openapi-including-examples.json` and `petshop-behavior-collection.json` from the Pet Shop, copied into
`test/fixtures`, next to small APIExamples, APIMetadata, AsyncAPI and GraphQL files.

`test:it` needs a Docker-compatible runtime. With Rancher Desktop:

```bash
DOCKER_HOST=unix://$HOME/.rd/docker.sock npm run test:it
```

Set `MICROCKS_IMAGE` to pin the image (default `quay.io/microcks/microcks-uber:latest`).

## Layout

```
src/lib/artifacts/   detect (type, as Microcks), kinds (identity, examples, filter per kind), parse, filter, catalog
src/lib/microcks/    client (REST + Keycloak, server only), live-state, journal, curl (command lines),
                     server (env, one client and one journal per process)
src/lib/plan.ts      selection + live state → ordered steps; what each selectable item's state is
src/lib/view.ts      sources + live state → the merged tree, its states, counts and tabs
src/lib/preview.ts   an example as an exchange, read from a source file, a draft, or Microcks
src/lib/runner.ts    runs steps against a MicrocksPort (the API routes in the browser, the client in tests)
src/lib/api.ts       the browser's calls to the API routes
src/lib/sources.ts   reading picked files, naming URLs
src/lib/design/      operations (what an OpenAPI operation declares), schema (samples, validation), draft (model,
                     issues), package (APIExamples), export (file or zip), store (IndexedDB, memory)
src/pages/api/       microcks/{status,services,services/[id],services/[id]/exchange,artifacts}, sources/fetch, journal
src/components/      App, SourcePicker, MicrocksStatus, CatalogTree, PlanPanel, Console, Check, ExamplePreview
src/components/design/  DesignView, DraftEditor, PackagePanel, useDrafts
test/unit/           vitest, no container
test/it/             vitest + @microcks/microcks-testcontainers
```
