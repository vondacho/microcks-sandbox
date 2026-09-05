package com.example.petshop.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.OAuthFlow;
import io.swagger.v3.oas.models.security.OAuthFlows;
import io.swagger.v3.oas.models.security.Scopes;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Publishes the OIDC security scheme so Swagger UI can fetch a token itself. */
@Configuration
public class OpenApiConfig {

    private final String issuerUri;

    public OpenApiConfig(
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}") String issuerUri) {
        this.issuerUri = issuerUri;
    }

    @Bean
    OpenAPI petShopOpenApi() {
        OAuthFlow authorizationCode =
                new OAuthFlow()
                        .authorizationUrl(issuerUri + "/protocol/openid-connect/auth")
                        .tokenUrl(issuerUri + "/protocol/openid-connect/token")
                        .scopes(
                                new Scopes()
                                        .addString("pets:read", "Read the pet inventory")
                                        .addString("pets:write", "Create, update and delete pets"));

        SecurityScheme oidc =
                new SecurityScheme()
                        .type(SecurityScheme.Type.OAUTH2)
                        .flows(new OAuthFlows().authorizationCode(authorizationCode));

        return new OpenAPI()
                .info(
                        new Info()
                                .title("Pet Shop API")
                                .version("v1")
                                .description(
                                        "Pet shop inventory. Every endpoint requires an OIDC access"
                                                + " token."))
                .components(new Components().addSecuritySchemes("oidc", oidc));
    }
}
