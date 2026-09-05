package com.example.petshop.web;

import com.example.petshop.domain.PetStatus;
import com.example.petshop.service.PetService;
import com.example.petshop.web.dto.PetRequest;
import com.example.petshop.web.dto.PetResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/pets")
@Tag(name = "Pets", description = "Pet shop inventory")
@SecurityRequirement(name = "oidc")
public class PetController {

    private final PetService service;

    public PetController(PetService service) {
        this.service = service;
    }

    @GetMapping
    public List<PetResponse> list(@RequestParam(required = false) PetStatus status) {
        return service.findAll(status).stream().map(PetResponse::from).toList();
    }

    @GetMapping("/{id}")
    public PetResponse get(@PathVariable Long id) {
        return PetResponse.from(service.findById(id));
    }

    @PostMapping
    public ResponseEntity<PetResponse> create(@Valid @RequestBody PetRequest request) {
        PetResponse created = PetResponse.from(service.create(request));
        return ResponseEntity.created(URI.create("/api/pets/" + created.id())).body(created);
    }

    @PutMapping("/{id}")
    public PetResponse replace(@PathVariable Long id, @Valid @RequestBody PetRequest request) {
        return PetResponse.from(service.replace(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
