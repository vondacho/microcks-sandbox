package com.example.petshop.e2e;

import static com.example.petshop.e2e.KeycloakSupport.SCOPE_READ;
import static com.example.petshop.e2e.KeycloakSupport.SCOPE_WRITE;
import static org.assertj.core.api.Assertions.assertThat;

import com.example.petshop.domain.Pet;
import com.example.petshop.domain.PetStatus;
import com.example.petshop.repository.PetRepository;
import io.github.microcks.testcontainers.MicrocksContainersEnsemble;
import io.github.microcks.testcontainers.model.Header;
import io.github.microcks.testcontainers.model.TestCaseResult;
import io.github.microcks.testcontainers.model.TestRequest;
import io.github.microcks.testcontainers.model.TestResult;
import io.github.microcks.testcontainers.model.TestRunnerType;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.ServerSocket;
import java.time.Duration;
import java.util.List;
import java.util.Map;
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
 * Behaviour conformance: the same examples replayed by {@link PetShopConformanceIT}, judged this
 * time on what the answers <em>say</em> rather than on their shape.
 *
 * <p>The {@code OPEN_API_SCHEMA} runner validates a response against the JSON Schema declared for
 * its status code, and nothing more. It never compares the response with the response body the
 * example declares. So {@code sell_bella} — {@code PUT /api/pets/5} with {@code status: SOLD} —
 * passes that runner as long as some well-formed pet comes back: a service that quietly refused the
 * sale and answered {@code AVAILABLE} would still be "conformant". The claim being made here is the
 * one the schema cannot make: it is the <em>right</em> pet, in the state the exchange asked for.
 *
 * <h2>How Microcks is made to assert it</h2>
 *
 * <p>{@code petshop-behavior-collection.json} is imported as a <em>secondary</em> artifact on the
 * service the contract already defines. It contributes no examples of its own — only one test
 * script per operation, matched to the operation by the request's method and path. The
 * {@code POSTMAN} runner then replays each of the contract's examples exactly as before and runs
 * that operation's script against the live response. A script's failing assertion names itself in
 * the failure message, so the report says which claim broke, for which example.
 *
 * <p>This needs the {@code microcks-postman-runtime} sidecar, hence
 * {@link MicrocksContainersEnsemble} rather than a lone container.
 *
 * <h2>What this still is not</h2>
 *
 * <p>Microcks replays operations independently: there is no ordering between them and no way to
 * carry a value from one response into the next request. Sequences — create, then fetch what was
 * created; delete, then confirm it is gone — remain the business of {@link PetShopE2EIT}. The
 * scripts here are written so that no assertion depends on the order operations happen to run in.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {
            // A database of its own, for the reason given in PetShopConformanceIT: failsafe reuses
            // one JVM, and a shared in-memory H2 would carry its identity counter across classes.
            "spring.datasource.url=jdbc:h2:mem:petshop-behavior;DB_CLOSE_DELAY=-1"
        })
@Testcontainers
class PetShopBehaviorConformanceIT {

    private static final String IMAGE = "quay.io/microcks/microcks-uber:latest";

    /** The contract under test, as published in {@code src/main/resources}. */
    private static final String CONTRACT = "openapi-examples.json";

    /** The behavioural assertions, layered onto the service the contract defines. */
    private static final String COLLECTION = "petshop-behavior-collection.json";

    /** {@code info.title} + ':' + {@code info.version} from the contract. */
    private static final String SERVICE_ID = "Pet Shop API:v1";

    /** See {@link PetShopConformanceIT} — the port must be fixed before any container starts. */
    private static final int APP_PORT = freePort();

    static {
        org.testcontainers.Testcontainers.exposeHostPorts(APP_PORT);
    }

    @Container static final GenericContainer<?> keycloak = KeycloakSupport.newContainer();

    @Container static final MicrocksContainersEnsemble microcks = newEnsemble();

    @Autowired private PetRepository repository;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("server.port", () -> APP_PORT);
        registry.add(
                "spring.security.oauth2.resourceserver.jwt.issuer-uri",
                () -> KeycloakSupport.issuerUri(keycloak));
    }

    /** The inventory the examples describe: {@code rex} is pet 1, {@code sell_bella} is pet 5. */
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
    @DisplayName("the live API behaves as the contract's examples say it does")
    void apiBehavesAsTheExamplesDescribe() throws Exception {
        String endpoint = "http://host.testcontainers.internal:" + APP_PORT;

        TestRequest request =
                new TestRequest.Builder()
                        .serviceId(SERVICE_ID)
                        .runnerType(TestRunnerType.POSTMAN.name())
                        .testEndpoint(endpoint)
                        .operationsHeaders(Map.of("globals", globalHeaders()))
                        .timeout(Duration.ofSeconds(120))
                        .build();

        TestResult result = microcks.getMicrocksContainer().testEndpoint(request);

        assertThat(result.getTestCaseResults())
                .as("every operation must carry a script and have been exercised")
                .extracting(TestCaseResult::getOperationName)
                .containsExactlyInAnyOrder(
                        "GET /api/pets",
                        "POST /api/pets",
                        "GET /api/pets/{id}",
                        "PUT /api/pets/{id}",
                        "DELETE /api/pets/{id}");
        assertThat(result.isSuccess())
                .as("behaviour failures:%n%s", describe(result))
                .isTrue();

        System.out.println("Microcks behaviour test result:%n%s".formatted(describe(result)));
    }

    /**
     * Headers attached to every replayed request.
     *
     * <p>{@code Authorization} is not passed as a Microcks {@link
     * io.github.microcks.testcontainers.model.Secret} the way {@link PetShopConformanceIT} passes
     * it: the Postman runner builds its requests from the operation's headers and the test's own
     * headers only, and never consults the secret. {@code Content-Type} is needed because the
     * Postman runtime defaults a raw body to {@code text/plain}, which the API would answer with
     * 415 for {@code POST} and {@code PUT}; on the bodyless operations it is simply ignored.
     */
    private static List<Header> globalHeaders() {
        String token = KeycloakSupport.clientCredentialsToken(keycloak, SCOPE_READ, SCOPE_WRITE);
        return List.of(
                header("Authorization", "Bearer " + token),
                header("Content-Type", "application/json"));
    }

    private static Header header(String name, String value) {
        Header header = new Header();
        header.setName(name);
        header.setValues(value);
        return header;
    }

    private static MicrocksContainersEnsemble newEnsemble() {
        MicrocksContainersEnsemble ensemble =
                new MicrocksContainersEnsemble(IMAGE)
                        .withMainArtifacts(CONTRACT)
                        .withSecondaryArtifacts(COLLECTION)
                        .withPostman()
                        .withDebugLogLevel();
        // The ensemble exposes no startup timeout of its own; the images are large enough that the
        // Testcontainers default is tight on a cold pull.
        ensemble.getMicrocksContainer().withStartupTimeout(Duration.ofMinutes(3));
        return ensemble;
    }

    private static Pet pet(String name, String category, PetStatus status, String price) {
        return new Pet(name, category, status, new BigDecimal(price));
    }

    /**
     * Renders per-operation outcomes. For a behaviour failure the message is the name of the
     * assertion that broke, so a failure reads as the claim that stopped holding.
     *
     * <p>The Postman runtime is configured by Microcks to stop an operation at its first failing
     * example, so later examples of a failing operation are simply absent from the report.
     */
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
