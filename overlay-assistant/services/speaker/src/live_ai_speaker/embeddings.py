from __future__ import annotations

import math
from collections.abc import Sequence


class EmbeddingError(ValueError):
    """Raised when an embedding cannot be compared safely."""


def normalize_vector(vector: Sequence[float]) -> tuple[float, ...]:
    if not vector:
        raise EmbeddingError("embedding is empty")
    values = tuple(float(value) for value in vector)
    if not all(math.isfinite(value) for value in values):
        raise EmbeddingError("embedding contains a non-finite value")
    magnitude = math.sqrt(math.fsum(value * value for value in values))
    if magnitude <= 1e-12:
        raise EmbeddingError("embedding has zero magnitude")
    return tuple(value / magnitude for value in values)


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        raise EmbeddingError("embedding dimensions do not match")
    left_unit = normalize_vector(left)
    right_unit = normalize_vector(right)
    similarity = math.fsum(a * b for a, b in zip(left_unit, right_unit, strict=True))
    return max(-1.0, min(1.0, similarity))


def merge_owner_embeddings(
    existing: Sequence[float], existing_count: int, new: Sequence[float]
) -> tuple[float, ...]:
    if existing_count < 1:
        raise EmbeddingError("existing sample count must be positive")
    if len(existing) != len(new):
        raise EmbeddingError("embedding dimensions do not match")
    old_unit = normalize_vector(existing)
    new_unit = normalize_vector(new)
    weighted = tuple(
        old_value * existing_count + new_value
        for old_value, new_value in zip(old_unit, new_unit, strict=True)
    )
    return normalize_vector(weighted)
