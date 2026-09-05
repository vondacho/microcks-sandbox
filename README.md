# Pet Shop API

A Spring Boot REST API for a pet shop. Every business endpoint is an OAuth2 **resource server**
endpoint: requests must carry an OpenID Connect access token as a `Bearer` token, or they are
rejected with `401`.

- Spring Boot 4.1.1 / Spring Security 7.1.1 / Java 25
- JWT validation against an OIDC provider's discovery document
- Scope-based authorization (`pets:read`, `pets:write`)
- H2 in-memory persistence via Spring Data JPA
- OpenAPI 3 + Swagger UI wired to the provider so you can grab a token from the browser

## Endpoints

| Method   | Path             | Required scope | Notes                                    |
| -------- | ---------------- | -------------- | ---------------------------------------- |
| `GET`    | `/api/pets`      | `pets:read`    | Optional `?status=AVAILABLE\|PENDING\|SOLD` |
| `GET`    | `/api/pets/{id}` | `pets:read`    | `404` as an RFC 9457 problem detail       |
| `POST`   | `/api/pets`      | `pets:write`   | `201` + `Location`                        |
| `PUT`    | `/api/pets/{id}` | `pets:write`   | Full replace                              |
| `DELETE` | `/api/pets/{id}` | `pets:write`   | `204`                                     |

Public (no token): `/actuator/health`, `/actuator/info`, `/v3/api-docs/**`, `/swagger-ui/**`.

A pet is `{ id, name, category, status, price }`.

## Run it

### 1. Start the OIDC provider

A pre-configured Keycloak realm ships with the project:

```bash
docker compose up -d          # Keycloak on http://localhost:8081 (admin/admin)
```

The `petshop` realm is imported automatically with:

| Subject                                     | Credentials                       | Grants                       |
| ------------------------------------------- | --------------------------------- | ---------------------------- |
| `petshop-service` (confidential, m2m)       | secret `petshop-service-secret`   | `pets:read`, `pets:write`    |
| `petshop-swagger` (public, PKCE)            | —                                 | browser login for Swagger UI |
| user `alice`                                | `alice` / `alice`                 | realm role `shop-admin`      |
| user `bob`                                  | `bob` / `bob`                     | realm role `shop-staff`      |

### 2. Start the API

```bash
./mvnw spring-boot:run         # http://localhost:8080
```

The API starts even when Keycloak is down — the JWT decoder resolves the discovery document lazily,
on the first authenticated request.

### 3. Call it

```bash
curl -i localhost:8080/api/pets
# HTTP/1.1 401
# WWW-Authenticate: Bearer resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource"

TOKEN=$(./get-token.sh)
curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/pets | jq

curl -s -X POST localhost:8080/api/pets \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bella","category":"DOG","status":"AVAILABLE","price":399.99}'
```

To see a scope being enforced rather than just presence of a token:

```bash
READ_ONLY=$(./get-token.sh "pets:read")
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8080/api/pets \
  -H "Authorization: Bearer $READ_ONLY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bella","category":"DOG","status":"AVAILABLE","price":399.99}'
# 403
```

Or use Swagger UI at <http://localhost:8080/swagger-ui.html> — click **Authorize**, and it runs the
authorization-code + PKCE flow against Keycloak for you.

### 4. Or explore from the editor

`src/main/resources/petshop-api.http` is a scratch file covering the whole surface: discovery, the
token requests, the 401/403 rejections, full CRUD, and validation. Run the client-credentials
request in section 2 first — its response handler stashes the token in `{{access_token}}`, which
every later request reuses. Variables live in `http-client.env.json`; select the **dev**
environment. Works in IntelliJ IDEA and in VS Code with the REST Client extension.

Both files are dev-only and are excluded from the packaged jar.

## How the protection is wired

`config/SecurityConfig.java` is the whole story:

- `oauth2ResourceServer(...jwt(...))` makes Spring Security validate the bearer JWT's signature,
  issuer and expiry against the provider's JWKS. No token, bad token, or expired token → `401`.
- `authorizeHttpRequests(...)` maps HTTP method + path to a required scope. Valid token, wrong
  scope → `403`.
- The session policy is `STATELESS` and CSRF is off, because a bearer-token API keeps no session
  and reads no cookies.

`config/JwtAuthoritiesConverter.java` turns token claims into authorities: the standard `scope`
claim becomes `SCOPE_*` (what the rules above match on), and Keycloak's `realm_access.roles`
becomes `ROLE_*`, so you can add `@PreAuthorize("hasRole('shop-admin')")` on a method when a
route-level rule is too coarse. `@EnableMethodSecurity` is already on.

## Pointing at a different provider

Only the issuer changes — Auth0, Entra ID, Okta and friends all work the same way:

```bash
PETSHOP_ISSUER_URI=https://your-tenant.auth0.com/ ./mvnw spring-boot:run
```

Two things usually need attention on a non-Keycloak provider:

- **Scope naming.** Adjust `SCOPE_READ` / `SCOPE_WRITE` in `SecurityConfig` if your provider issues
  different scope strings.
- **Audience.** Uncomment `spring.security.oauth2.resourceserver.jwt.audiences` in
  `application.yml` to reject tokens that were minted for a different API.

## Tests

Two tiers, split by filename so the fast one never needs a container runtime.

```bash
./mvnw test      # 12 unit/slice tests  — no Docker, ~10s
./mvnw verify    # + 10 end-to-end tests — real Keycloak in a container, ~70s
```

**`*Test` (surefire).** `JwtDecoderTestConfig` swaps in a `JwtDecoder` double, so tokens are handed
straight to MockMvc and no provider is needed. `PetApiSecurityTest` pins down 401 without a token,
403 with the wrong scope, and 200/201 with the right one.

**`*IT` (failsafe).** `PetShopE2EIT` starts the real `quay.io/keycloak/keycloak:26.4` image via
Testcontainers, importing the *same* `keycloak/petshop-realm.json` that `compose.yaml` uses — the
file is put on the test classpath by a `<testResource>` entry, so there is one realm definition,
not two. `@DynamicPropertySource` points the resource server at the container's random port, and
RestAssured drives real HTTP against a real Tomcat.

This tier proves the parts a mocked decoder cannot: that the JWT signature is genuinely verified
against Keycloak's live JWKS, and that a tampered token is rejected.

```
a token is required     anonymous 401 · forged 401 · tampered signature 401 · genuine 200
scopes are enforced     read-only cannot POST 403 · write-only cannot GET 403 · password grant 200
inventory lifecycle     create 201 → read 200 → replace 200 → filter → delete 204 → 404 · invalid 400
the API documentation   /swagger-ui.html renders, without a token
```

Any Docker-compatible runtime works — Docker Desktop, Rancher Desktop, Colima, Podman. Testcontainers
finds the socket via `~/.testcontainers.properties` or `DOCKER_HOST`; on Podman you usually also want
`TESTCONTAINERS_RYUK_DISABLED=true`.

## Layout

```
src/main/java/com/example/petshop/
├── PetShopApplication.java
├── config/
│   ├── SecurityConfig.java           # OIDC resource server + scope rules
│   ├── JwtAuthoritiesConverter.java  # claims -> authorities
│   └── OpenApiConfig.java            # OIDC scheme for Swagger UI
├── domain/         Pet, PetStatus            (JPA entity)
├── repository/     PetRepository            (Spring Data)
├── service/        PetService, PetNotFoundException
└── web/            PetController, ApiExceptionHandler, dto/

src/test/java/com/example/petshop/
├── config/         JwtAuthoritiesConverterTest
├── support/        JwtDecoderTestConfig      (mocked decoder for *Test)
├── web/            PetApiSecurityTest, PetApiCrudTest
└── e2e/            PetShopE2EIT, KeycloakSupport   (real Keycloak, *IT)

src/main/resources/
├── application.yml
├── data.sql                  # seed inventory
├── petshop-api.http          # scratch file: tokens + every endpoint
└── http-client.env.json      # {{host}}, {{issuer}}, client credentials
```
