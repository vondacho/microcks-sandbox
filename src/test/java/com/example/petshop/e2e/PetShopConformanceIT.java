package com.example.petshop.e2e;

import static com.example.petshop.e2e.KeycloakSupport.SCOPE_READ;
import static com.example.petshop.e2e.KeycloakSupport.SCOPE_WRITE;
import static org.assertj.core.api.Assertions.assertThat;

import com.example.petshop.domain.Pet;
import com.example.petshop.domain.PetStatus;
import com.example.petshop.repository.PetRepository;
import io.github.microcks.testcontainers.MicrocksContainer;
import io.github.microcks.testcontainers.model.Secret;
import io.github.microcks.testcontainers.model.TestCaseResult;
import io.github.microcks.testcontainers.model.TestRequest;
import io.github.microcks.testcontainers.model.TestResult;
import io.github.microcks.testcontainers.model.TestRunnerType;
import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.ServerSocket;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Contract conformance: Microcks acts as the <em>client</em>, replaying every example declared in
 * {@code openapi-examples.json} against the live API and checking each response against the
 * contract's schema for that status code.
 *
 * <p>This is the inverse of {@link PetShopE2EIT}. There, the tests state what the API should do.
 * Here, nothing is asserted by hand — the contract is the specification, and the only question
 * asked is whether the running service still honours it. A drift between code and published
 * contract fails this test without anyone having written an assertion about it.
 *
 * <h2>Secrets</h2>
 *
 * Every operation in the contract is protected, so Microcks cannot replay a single example without
 * credentials. A token is minted from Keycloak on the host and handed to Microcks as a
 * {@link Secret}, which Microcks then attaches to each replayed request.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {
            // A database of its own: failsafe reuses one JVM, and sharing the in-memory H2 with
            // PetShopE2EIT would carry its identity counter over and shift the seeded ids below.
            "spring.datasource.url=jdbc:h2:mem:petshop-conformance;DB_CLOSE_DELAY=-1"
        })
@Testcontainers
class PetShopConformanceIT {

    /** The contract under test, as published in {@code src/main/resources}. */
    private static final String CONTRACT = "openapi-examples.json";

    /** {@code info.title} + ':' + {@code info.version} from that contract. */
    private static final String SERVICE_ID = "Pet Shop API:v1";

    private static final String SECRET_NAME = "petshop-oidc-token";

    /**
     * The API's port is fixed before any container starts, because {@code exposeHostPorts} only
     * reaches containers created after the call — and Testcontainers starts its containers before
     * Spring boots the app. A random free port keeps parallel builds from colliding.
     */
    private static final int APP_PORT = freePort();

    static {
        org.testcontainers.Testcontainers.exposeHostPorts(APP_PORT);
    }

    @Container static final GenericContainer<?> keycloak = KeycloakSupport.newContainer();

    @Container
    static final MicrocksContainer microcks =
            new MicrocksContainer("quay.io/microcks/microcks-uber:latest")
                    .withMainArtifacts(CONTRACT)
                    .withStartupTimeout(Duration.ofMinutes(3))
                    .withDebugLogLevel();

    @Autowired private PetRepository repository;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("server.port", () -> APP_PORT);
        registry.add(
                "spring.security.oauth2.resourceserver.jwt.issuer-uri",
                () -> KeycloakSupport.issuerUri(keycloak));
    }

    /**
     * Gives the contract's examples the state they describe: {@code rex} addresses pet 1 and
     * {@code sell_bella} addresses pet 5, so five pets must exist with those identities.
     */
    @BeforeEach
    void seedTheInventoryTheContractDescribes() {
        repository.deleteAll();
        repository.saveAll(
                List.of(
                        pet("Rex", "DOG", PetStatus.AVAILABLE, "450.00"),
                        pet("Whiskers", "CAT", PetStatus.AVAILABLE, "220.00"),
                        pet("Nemo", "FISH", PetStatus.PENDING, "35.50"),
                        pet("Kiwi", "BIRD", PetStatus.SOLD, "120.00"),
                        pet("Bella", "DOG", PetStatus.AVAILABLE, "399.99")));
    }

    @Test
    @DisplayName("the live API conforms to the published contract, examples and all")
    void apiConformsToContract() throws Exception {
        // Microcks runs outside the host's network namespace, so it reaches the API through the
        // alias Testcontainers forwards back to the host.
        String endpoint = "http://host.testcontainers.internal:" + APP_PORT;

        microcks.createSecret(oidcSecret());

        TestRequest request =
                new TestRequest.Builder()
                        .serviceId(SERVICE_ID)
                        .runnerType(TestRunnerType.OPEN_API_SCHEMA.name())
                        .testEndpoint(endpoint)
                        .secretName(SECRET_NAME)
                        .timeout(Duration.ofSeconds(90))
                        .build();

        TestResult result = microcks.testEndpoint(request);

        assertThat(result.getTestCaseResults())
                .as("every operation in the contract must actually have been replayed")
                .extracting(TestCaseResult::getOperationName)
                .containsExactlyInAnyOrder(
                        "GET /api/pets",
                        "POST /api/pets",
                        "GET /api/pets/{id}",
                        "PUT /api/pets/{id}",
                        "DELETE /api/pets/{id}");
        assertThat(result.isSuccess())
                .as("conformance failures:%n%s", describe(result))
                .isTrue();

        System.out.println("Microcks conformance test result:%n%s".formatted(describe(result)));
    }

    /**
     * Carries the access token to Microcks. {@code tokenHeader} is set explicitly so the header
     * Microcks sends is exactly the one written here, rather than relying on how Microcks composes
     * a bearer header when only {@code token} is given.
     */
    private Secret oidcSecret() {
        String token = KeycloakSupport.clientCredentialsToken(keycloak, SCOPE_READ, SCOPE_WRITE);
        return new Secret.Builder()
                .name(SECRET_NAME)
                .description("OIDC access token for replaying the pet shop examples")
                .tokenHeader("Authorization")
                .token("Bearer " + token)
                .build();
    }

    private static Pet pet(String name, String category, PetStatus status, String price) {
        return new Pet(name, category, status, new BigDecimal(price));
    }

    /** Renders per-operation outcomes so a failure names the operation that drifted. */
    private static String describe(TestResult result) {
        StringBuilder sb = new StringBuilder();
        result.getTestCaseResults()
                .forEach(
                        tc -> {
                            sb.append("  %-40s %s%n".formatted(tc.getOperationName(),
                                    tc.isSuccess() ? "OK" : "FAILED"));
                            if (tc.getTestStepResults() != null) {
                                tc.getTestStepResults().stream()
                                        .filter(st -> !st.isSuccess())
                                        .forEach(st -> sb.append("      example '%s': %s%n"
                                                .formatted(st.getRequestName(), st.getMessage())));
                            }
                        });
        return sb.toString();
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException("no free port for the API under test", e);
        }
    }
}
