package com.example.petshop.web.dto;

import com.example.petshop.domain.PetStatus;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/** Payload accepted when creating or replacing a pet. */
public record PetRequest(
        @NotBlank @Size(max = 100) String name,
        @NotBlank @Size(max = 100) String category,
        @NotNull PetStatus status,
        @NotNull @DecimalMin(value = "0.0", inclusive = true) BigDecimal price) {
}
