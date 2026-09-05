package com.example.petshop.e2e;

import static com.example.petshop.e2e.KeycloakSupport.KEYCLOAK;
import static com.example.petshop.e2e.KeycloakSupport.SCOPE_READ;
import static com.example.petshop.e2e.KeycloakSupport.SCOPE_WRITE;
import static com.example.petshop.e2e.KeycloakSupport.clientCredentialsToken;
import static com.example.petshop.e2e.KeycloakSupport.passwordToken;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import com.example.petshop.repository.PetRepository;
import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * End-to-end coverage of the OIDC protection: a real Keycloak issues real signed tokens, the API
 * runs in a real servlet container, and every call goes over real HTTP.
 *
 * <p>Nothing here is stubbed — in particular the JWT signature, issuer and expiry are validated
 * against Keycloak's live JWKS endpoint, which is the one thing the MockMvc tests cannot prove.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class PetShopE2EIT {

    @Container static final org.testcontainers.containers.GenericContainer<?> keycloak = KEYCLOAK;

    private static final String PET =
            """
            {"name":"Bella","category":"DOG","status":"AVAILABLE","price":399.99}
            """;

    @LocalServerPort private int port;

    @Autowired private PetRepository repository;

    /** Points the resource server at the container Keycloak that JUnit has just started. */
    @DynamicPropertySource
    static void oidcIssuer(DynamicPropertyRegistry registry) {
        registry.add(
                "spring.security.oauth2.resourceserver.jwt.issuer-uri",
                KeycloakSupport::issuerUri);
    }

    @BeforeEach
    void setUp() {
        RestAssured.baseURI = "http://localhost";
        RestAssured.port = port;
        RestAssured.basePath = "/api/pets";
        repository.deleteAll();
    }

    @Nested
    @DisplayName("a token is required")
    class Authentication {

        @Test
        @DisplayName("no Authorization header -> 401 with a Bearer challenge")
        void anonymousIsRejected() {
            given().when()
                    .get()
                    .then()
                    .statusCode(401)
                    .header("WWW-Authenticate", notNullValue());
        }

        @Test
        @DisplayName("a token Keycloak never signed -> 401")
        void forgedTokenIsRejected() {
            given().auth()
                    .oauth2("not-a-real-token")
                    .when()
                    .get()
                    .then()
                    .statusCode(401);
        }

        @Test
        @DisplayName("a syntactically valid JWT with a bogus signature -> 401")
        void tamperedTokenIsRejected() {
            String token = clientCredentialsToken(SCOPE_READ);
            String tampered = token.substring(0, token.lastIndexOf('.') + 1) + "AAAAdeadbeef";

            given().auth().oauth2(tampered).when().get().then().statusCode(401);
        }

        @Test
        @DisplayName("a genuine Keycloak token is accepted")
        void genuineTokenIsAccepted() {
            String token = clientCredentialsToken(SCOPE_READ);
            assertThat(token).isNotBlank();

            given().auth().oauth2(token).when().get().then().statusCode(200);
        }
    }

    @Nested
    @DisplayName("scopes are enforced")
    class Authorization {

        @Test
        @DisplayName("pets:read alone cannot create -> 403")
        void readScopeCannotWrite() {
            given().auth()
                    .oauth2(clientCredentialsToken(SCOPE_READ))
                    .contentType(ContentType.JSON)
                    .body(PET)
                    .when()
                    .post()
                    .then()
                    .statusCode(403);
        }

        @Test
        @DisplayName("pets:write alone cannot read -> 403")
        void writeScopeCannotRead() {
            given().auth()
                    .oauth2(clientCredentialsToken(SCOPE_WRITE))
                    .when()
                    .get()
                    .then()
                    .statusCode(403);
        }

        @Test
        @DisplayName("a human token (password grant) works the same way")
        void passwordGrantTokenIsAccepted() {
            given().auth()
                    .oauth2(passwordToken("alice", "alice", SCOPE_READ))
                    .when()
                    .get()
                    .then()
                    .statusCode(200);
        }
    }

    @Nested
    @DisplayName("the inventory lifecycle")
    class Lifecycle {

        @Test
        @DisplayName("create, read, replace, delete")
        void fullLifecycle() {
            String token = clientCredentialsToken(SCOPE_READ, SCOPE_WRITE);

            int id =
                    given().auth()
                            .oauth2(token)
                            .contentType(ContentType.JSON)
                            .body(PET)
                            .when()
                            .post()
                            .then()
                            .statusCode(201)
                            .header("Location", notNullValue())
                            .body("name", equalTo("Bella"))
                            .extract()
                            .path("id");

            given().auth()
                    .oauth2(token)
                    .when()
                    .get("/{id}", id)
                    .then()
                    .statusCode(200)
                    .body("category", equalTo("DOG"))
                    .body("status", equalTo("AVAILABLE"));

            given().auth()
                    .oauth2(token)
                    .contentType(ContentType.JSON)
                    .body(
                            """
                            {"name":"Bella","category":"DOG","status":"SOLD","price":420.00}
                            """)
                    .when()
                    .put("/{id}", id)
                    .then()
                    .statusCode(200)
                    .body("status", equalTo("SOLD"));

            given().auth()
                    .oauth2(token)
                    .queryParam("status", "SOLD")
                    .when()
                    .get()
                    .then()
                    .statusCode(200)
                    .body("size()", equalTo(1));

            given().auth().oauth2(token).when().delete("/{id}", id).then().statusCode(204);

            given().auth()
                    .oauth2(token)
                    .when()
                    .get("/{id}", id)
                    .then()
                    .statusCode(404)
                    .body("title", equalTo("Pet not found"));
        }

        @Test
        @DisplayName("an invalid payload is rejected before it reaches the database")
        void invalidPayloadIsRejected() {
            given().auth()
                    .oauth2(clientCredentialsToken(SCOPE_WRITE))
                    .contentType(ContentType.JSON)
                    .body("""
                            {"name":"","category":"DOG","status":"AVAILABLE","price":-1}
                            """)
                    .when()
                    .post()
                    .then()
                    .statusCode(400);

            assertThat(repository.count()).isZero();
        }
    }

    @Nested
    @DisplayName("the API documentation")
    class SwaggerUi {

        @Test
        @DisplayName("the Swagger UI page renders, and needs no token to do so")
        void swaggerUiPageIsServed() {
            String page =
                    given().basePath("")
                            .when()
                            .get("/swagger-ui.html") // 302 -> /swagger-ui/index.html
                            .then()
                            .statusCode(200)
                            .contentType(ContentType.HTML)
                            .extract()
                            .asString();

            assertThat(page)
                    .contains("<title>Swagger UI</title>")
                    .contains("id=\"swagger-ui\"");
        }
    }
}
