package com.example.petshop.service;

public class PetNotFoundException extends RuntimeException {

    public PetNotFoundException(Long id) {
        super("Pet " + id + " does not exist");
    }
}
