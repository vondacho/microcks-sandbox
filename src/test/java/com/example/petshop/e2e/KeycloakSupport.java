package com.example.petshop.e2e;

import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import java.time.Duration;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

/**
 * A real Keycloak, started in a container, importing the same realm definition that {@code
 * compose.yaml} uses locally.
 *
 * <p>The container is deliberately {@code static} and never stopped: JUnit starts it once for the
 * whole class and Testcontainers' resource reaper removes it when the JVM exits, so a suite of
 * end-to-end classes pays the Keycloak startup cost once.
 */
final class KeycloakSupport {

    static final String REALM = "petshop";
    static final String CLIENT_ID = "petshop-service";
    static final String CLIENT_SECRET = "petshop-service-secret";
    static final String SCOPE_READ = "pets:read";
    static final String SCOPE_WRITE = "pets:write";

    private static final int KEYCLOAK_PORT = 8080;

    static final GenericContainer<?> KEYCLOAK =
            new GenericContainer<>(DockerImageName.parse("quay.io/keycloak/keycloak:26.4"))
                    .withExposedPorts(KEYCLOAK_PORT)
                    .withEnv("KC_BOOTSTRAP_ADMIN_USERNAME", "admin")
                    .withEnv("KC_BOOTSTRAP_ADMIN_PASSWORD", "admin")
                    .withCopyFileToContainer(
                            MountableFile.forClasspathResource("petshop-realm.json"),
                            "/opt/keycloak/data/import/petshop-realm.json")
                    .withCommand("start-dev", "--import-realm")
                    .waitingFor(
                            Wait.forHttp("/realms/" + REALM + "/.well-known/openid-configuration")
                                    .forPort(KEYCLOAK_PORT)
                                    .forStatusCode(200))
                    .withStartupTimeout(Duration.ofMinutes(3));

    private KeycloakSupport() {}

    /** The issuer the API must be configured with, as seen from the host. */
    static String issuerUri() {
        return "http://%s:%d/realms/%s"
                .formatted(KEYCLOAK.getHost(), KEYCLOAK.getMappedPort(KEYCLOAK_PORT), REALM);
    }

    /**
     * Requests a genuine, signed access token from Keycloak.
     *
     * <p>{@code pets:read} and {@code pets:write} are <em>optional</em> client scopes in the realm,
     * so a token only carries what this call asks for — which is what lets the tests tell 403 apart
     * from 401.
     */
    static String clientCredentialsToken(String... scopes) {
        return tokenRequest()
                .formParam("grant_type", "client_credentials")
                .formParam("scope", String.join(" ", scopes))
                .when()
                .post()
                .then()
                .statusCode(200)
                .extract()
                .path("access_token");
    }

    /** Requests a token on behalf of a human user (resource owner password grant). */
    static String passwordToken(String username, String password, String... scopes) {
        return tokenRequest()
                .formParam("grant_type", "password")
                .formParam("username", username)
                .formParam("password", password)
                .formParam("scope", String.join(" ", scopes))
                .when()
                .post()
                .then()
                .statusCode(200)
                .extract()
                .path("access_token");
    }

    private static RequestSpecification tokenRequest() {
        RequestSpecification endpoint =
                new RequestSpecBuilder()
                        .setBaseUri("http://" + KEYCLOAK.getHost())
                        .setPort(KEYCLOAK.getMappedPort(KEYCLOAK_PORT))
                        .setBasePath("/realms/" + REALM + "/protocol/openid-connect/token")
                        .build();
        return RestAssured.given()
                .spec(endpoint)
                .contentType(ContentType.URLENC)
                .formParam("client_id", CLIENT_ID)
                .formParam("client_secret", CLIENT_SECRET);
    }
}
