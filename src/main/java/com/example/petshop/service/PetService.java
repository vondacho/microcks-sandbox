package com.example.petshop.service;

import com.example.petshop.domain.Pet;
import com.example.petshop.domain.PetStatus;
import com.example.petshop.repository.PetRepository;
import com.example.petshop.web.dto.PetRequest;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class PetService {

    private final PetRepository repository;

    public PetService(PetRepository repository) {
        this.repository = repository;
    }

    public List<Pet> findAll(PetStatus status) {
        return status == null ? repository.findAll() : repository.findByStatus(status);
    }

    public Pet findById(Long id) {
        return repository.findById(id).orElseThrow(() -> new PetNotFoundException(id));
    }

    @Transactional
    public Pet create(PetRequest request) {
        return repository.save(
                new Pet(request.name(), request.category(), request.status(), request.price()));
    }

    @Transactional
    public Pet replace(Long id, PetRequest request) {
        Pet pet = findById(id);
        pet.setName(request.name());
        pet.setCategory(request.category());
        pet.setStatus(request.status());
        pet.setPrice(request.price());
        return pet;
    }

    @Transactional
    public void delete(Long id) {
        if (!repository.existsById(id)) {
            throw new PetNotFoundException(id);
        }
        repository.deleteById(id);
    }
}
