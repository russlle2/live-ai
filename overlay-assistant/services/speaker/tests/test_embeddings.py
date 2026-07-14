from __future__ import annotations

import math
import unittest

from live_ai_speaker.embeddings import (
    EmbeddingError,
    cosine_similarity,
    merge_owner_embeddings,
    normalize_vector,
)


class EmbeddingMathTests(unittest.TestCase):
    def test_cosine_similarity_handles_scale(self) -> None:
        self.assertAlmostEqual(cosine_similarity((2.0, 0.0), (4.0, 0.0)), 1.0)
        self.assertAlmostEqual(cosine_similarity((1.0, 0.0), (0.0, 3.0)), 0.0)

    def test_normalization_rejects_unsafe_vectors(self) -> None:
        with self.assertRaises(EmbeddingError):
            normalize_vector((0.0, 0.0))
        with self.assertRaises(EmbeddingError):
            normalize_vector((math.nan, 1.0))

    def test_merge_preserves_unit_length(self) -> None:
        merged = merge_owner_embeddings((1.0, 0.0), 2, (0.8, 0.6))
        self.assertAlmostEqual(sum(value * value for value in merged), 1.0)
        self.assertGreater(merged[0], merged[1])


if __name__ == "__main__":
    unittest.main()
