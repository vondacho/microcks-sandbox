package com.example.petshop.repository;

import com.example.petshop.domain.Pet;
import com.example.petshop.domain.PetStatus;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PetRepository extends JpaRepository<Pet, Long> {

    List<Pet> findByStatus(PetStatus status);
}
