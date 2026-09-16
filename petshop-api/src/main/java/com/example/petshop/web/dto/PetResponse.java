package com.example.petshop.web.dto;

import com.example.petshop.domain.Pet;
import com.example.petshop.domain.PetStatus;
import java.math.BigDecimal;

/** Representation of a pet returned to API clients. */
public record PetResponse(
        Long id,
        String name,
        String category,
        PetStatus status,
        BigDecimal price) {

    public static PetResponse from(Pet pet) {
        return new PetResponse(
                pet.getId(), pet.getName(), pet.getCategory(), pet.getStatus(), pet.getPrice());
    }
}
