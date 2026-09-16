package com.example.petshop.web;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.petshop.support.JwtDecoderTestConfig;
import com.example.petshop.repository.PetRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Exercises the pet lifecycle with a token that carries both scopes. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(JwtDecoderTestConfig.class)
class PetApiCrudTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private PetRepository repository;

    private final RequestPostProcessor fullAccess =
            jwt().authorities(
                            new SimpleGrantedAuthority("SCOPE_pets:read"),
                            new SimpleGrantedAuthority("SCOPE_pets:write"));

    @BeforeEach
    void resetInventory() {
        repository.deleteAll();
    }

    @Test
    void createReadUpdateDelete() throws Exception {
        String created =
                mockMvc.perform(
                                post("/api/pets")
                                        .with(fullAccess)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"name":"Bella","category":"DOG",
                                                 "status":"AVAILABLE","price":399.99}
                                                """))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.id").isNumber())
                        .andExpect(jsonPath("$.name").value("Bella"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        long id = Long.parseLong(created.replaceAll(".*\"id\":(\\d+).*", "$1"));

        mockMvc.perform(get("/api/pets/{id}", id).with(fullAccess))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.category").value("DOG"));

        mockMvc.perform(
                        put("/api/pets/{id}", id)
                                .with(fullAccess)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"name":"Bella","category":"DOG",
                                         "status":"SOLD","price":420.00}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SOLD"));

        mockMvc.perform(get("/api/pets").param("status", "SOLD").with(fullAccess))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        mockMvc.perform(delete("/api/pets/{id}", id).with(fullAccess))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/pets/{id}", id).with(fullAccess))
                .andExpect(status().isNotFound());
    }

    @Test
    void invalidPayloadIsRejected() throws Exception {
        mockMvc.perform(
                        post("/api/pets")
                                .with(fullAccess)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {"name":"","category":"DOG","status":"AVAILABLE","price":-1}
                                        """))
                .andExpect(status().isBadRequest());
    }
}
