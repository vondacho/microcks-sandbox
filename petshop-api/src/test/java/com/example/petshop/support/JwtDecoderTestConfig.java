package com.example.petshop.support;

import static org.mockito.Mockito.mock;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/**
 * Replaces the real {@link JwtDecoder} so tests never reach out to the OIDC provider's discovery
 * endpoint. Tokens are supplied directly by {@code SecurityMockMvcRequestPostProcessors.jwt()}.
 */
@TestConfiguration
public class JwtDecoderTestConfig {

    @Bean
    JwtDecoder jwtDecoder() {
        return mock(JwtDecoder.class);
    }
}
