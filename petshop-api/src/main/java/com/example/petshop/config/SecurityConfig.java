package com.example.petshop.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Locks every pet-shop resource behind an OpenID Connect access token.
 *
 * <p>The API is a pure OAuth2 <em>resource server</em>: it never logs a user in, it only validates
 * the bearer JWT that an OIDC provider issued. Signature keys, issuer and expiry are checked by
 * Spring Security against the provider's discovery document
 * ({@code spring.security.oauth2.resourceserver.jwt.issuer-uri}).
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    static final String SCOPE_READ = "SCOPE_pets:read";
    static final String SCOPE_WRITE = "SCOPE_pets:write";

    @Bean
    SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                "/actuator/health",
                                                "/actuator/health/**",
                                                "/actuator/info",
                                                "/v3/api-docs",
                                                "/v3/api-docs/**",
                                                "/swagger-ui.html",
                                                "/swagger-ui/**")
                                        .permitAll()
                                        .requestMatchers(HttpMethod.GET, "/api/pets/**")
                                        .hasAuthority(SCOPE_READ)
                                        .requestMatchers(HttpMethod.POST, "/api/pets/**")
                                        .hasAuthority(SCOPE_WRITE)
                                        .requestMatchers(HttpMethod.PUT, "/api/pets/**")
                                        .hasAuthority(SCOPE_WRITE)
                                        .requestMatchers(HttpMethod.DELETE, "/api/pets/**")
                                        .hasAuthority(SCOPE_WRITE)
                                        .anyRequest()
                                        .authenticated())
                .oauth2ResourceServer(
                        oauth2 -> oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtConverter())));
        return http.build();
    }

    private JwtAuthenticationConverter jwtConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(new JwtAuthoritiesConverter());
        return converter;
    }
}
