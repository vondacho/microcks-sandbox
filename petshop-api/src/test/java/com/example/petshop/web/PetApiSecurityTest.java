package com.example.petshop.web;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.petshop.support.JwtDecoderTestConfig;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Verifies that every pet-shop resource really is gated by an OIDC access token. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(JwtDecoderTestConfig.class)
class PetApiSecurityTest {

    private static final String BODY =
            """
            {"name":"Bella","category":"DOG","status":"AVAILABLE","price":399.99}
            """;

    @Autowired private MockMvc mockMvc;

    @Test
    @DisplayName("no token -> 401 Unauthorized")
    void anonymousReadIsRejected() throws Exception {
        mockMvc.perform(get("/api/pets")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("no token on a write -> 401 Unauthorized")
    void anonymousWriteIsRejected() throws Exception {
        mockMvc.perform(post("/api/pets").contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("valid token without the required scope -> 403 Forbidden")
    void tokenWithoutScopeIsForbidden() throws Exception {
        mockMvc.perform(get("/api/pets").with(jwt())).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("token with pets:read -> 200 on GET")
    void readScopeGrantsRead() throws Exception {
        mockMvc.perform(get("/api/pets").with(scopes("pets:read"))).andExpect(status().isOk());
    }

    @Test
    @DisplayName("token with only pets:read -> 403 on POST")
    void readScopeDoesNotGrantWrite() throws Exception {
        mockMvc.perform(
                        post("/api/pets")
                                .with(scopes("pets:read"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(BODY))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("token with pets:write -> 201 on POST")
    void writeScopeGrantsWrite() throws Exception {
        mockMvc.perform(
                        post("/api/pets")
                                .with(scopes("pets:write"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(BODY))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("token with only pets:write -> 403 on DELETE is not implied by read rules")
    void writeScopeGrantsDelete() throws Exception {
        mockMvc.perform(delete("/api/pets/999").with(scopes("pets:write")))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("actuator health stays open for probes")
    void healthIsPublic() throws Exception {
        mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    /** Builds a bearer-token stand-in carrying exactly the given OAuth2 scopes. */
    private static RequestPostProcessor scopes(String... scopes) {
        List<GrantedAuthority> authorities =
                Arrays.stream(scopes)
                        .map(scope -> (GrantedAuthority) new SimpleGrantedAuthority("SCOPE_" + scope))
                        .toList();
        return jwt().authorities(authorities);
    }
}
