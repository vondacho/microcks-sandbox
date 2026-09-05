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
 * Factory and helpers for a real Keycloak container, importing the same realm definition that
 * {@code compose.yaml} uses locally.
 *
 * <p>{@link #newContainer()} hands back a fresh, unstarted container so that each {@code *IT} class
 * can own one and delegate its lifecycle to JUnit with {@code @Container}. This is deliberately a
 * factory rather than one shared static instance: a shared instance would be stopped in the
 * {@code afterAll} of whichever class finished first, leaving the next class with a dead container
 * and a failure that depends on class execution order.
 *
 * <p>The cost is one Keycloak start per test class. If that ever outweighs the isolation, switch to
 * the singleton pattern — one static instance started in an initialiser here, no
 * {@code @Testcontainers}/{@code @Container}, reaped by Ryuk at JVM exit.
 */
final class KeycloakSupport {

    static final String REALM = "petshop";
    static final String CLIENT_ID = "petshop-service";
    static final String CLIENT_SECRET = "petshop-service-secret";
    static final String SCOPE_READ = "pets:read";
    static final String SCOPE_WRITE = "pets:write";

    private static final int KEYCLOAK_PORT = 8080;

    private KeycloakSupport() {}

    /** A fresh, unstarted Keycloak with the pet shop realm staged for import. */
    static GenericContainer<?> newContainer() {
        return new GenericContainer<>(DockerImageName.parse("quay.io/keycloak/keycloak:26.4"))
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
    }

    /** The issuer the API must be configured with, as seen from the host. */
    static String issuerUri(GenericContainer<?> keycloak) {
        return "http://%s:%d/realms/%s"
                .formatted(keycloak.getHost(), keycloak.getMappedPort(KEYCLOAK_PORT), REALM);
    }

    /**
     * Requests a genuine, signed access token from Keycloak.
     *
     * <p>{@code pets:read} and {@code pets:write} are <em>optional</em> client scopes in the realm,
     * so a token only carries what this call asks for — which is what lets the tests tell 403 apart
     * from 401.
     */
    static String clientCredentialsToken(GenericContainer<?> keycloak, String... scopes) {
        return tokenRequest(keycloak)
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
    static String passwordToken(
            GenericContainer<?> keycloak, String username, String password, String... scopes) {
        return tokenRequest(keycloak)
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

    private static RequestSpecification tokenRequest(GenericContainer<?> keycloak) {
        RequestSpecification endpoint =
                new RequestSpecBuilder()
                        .setBaseUri("http://" + keycloak.getHost())
                        .setPort(keycloak.getMappedPort(KEYCLOAK_PORT))
                        .setBasePath("/realms/" + REALM + "/protocol/openid-connect/token")
                        .build();
        return RestAssured.given()
                .spec(endpoint)
                .contentType(ContentType.URLENC)
                .formParam("client_id", CLIENT_ID)
                .formParam("client_secret", CLIENT_SECRET);
    }
}
