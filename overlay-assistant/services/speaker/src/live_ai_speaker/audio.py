from __future__ import annotations

import io
import wave
from dataclasses import dataclass


class AudioValidationError(ValueError):
    """Raised when uploaded audio is unsuitable for verification."""


@dataclass(frozen=True, slots=True)
class DecodedAudio:
    samples: tuple[float, ...]
    sample_rate: int
    duration_seconds: float


def _decode_sample(raw: bytes, width: int) -> float:
    if width == 1:
        return (raw[0] - 128) / 128.0
    value = int.from_bytes(raw, byteorder="little", signed=True)
    scale = float(1 << (width * 8 - 1))
    return max(-1.0, min(1.0, value / scale))


def _resample_linear(samples: list[float], source_rate: int, target_rate: int) -> list[float]:
    if source_rate == target_rate or len(samples) < 2:
        return samples
    output_size = max(1, round(len(samples) * target_rate / source_rate))
    if output_size == 1:
        return [samples[0]]
    scale = (len(samples) - 1) / (output_size - 1)
    output: list[float] = []
    for index in range(output_size):
        source_position = index * scale
        left = int(source_position)
        right = min(left + 1, len(samples) - 1)
        fraction = source_position - left
        output.append(samples[left] * (1.0 - fraction) + samples[right] * fraction)
    return output


def decode_pcm_wav(
    payload: bytes,
    *,
    target_sample_rate: int,
    min_seconds: float,
    max_seconds: float,
    max_payload_bytes: int,
) -> DecodedAudio:
    if not payload:
        raise AudioValidationError("audio body is empty")
    if len(payload) > max_payload_bytes:
        raise AudioValidationError("audio body exceeds the configured size limit")

    try:
        with wave.open(io.BytesIO(payload), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            source_rate = wav.getframerate()
            frame_count = wav.getnframes()
            compression = wav.getcomptype()
            if compression != "NONE":
                raise AudioValidationError("compressed WAV audio is not supported")
            if channels < 1 or channels > 8:
                raise AudioValidationError("WAV audio must have between 1 and 8 channels")
            if sample_width not in {1, 2, 3, 4}:
                raise AudioValidationError("WAV samples must be 8, 16, 24, or 32-bit PCM")
            if source_rate < 8_000 or source_rate > 192_000:
                raise AudioValidationError("WAV sample rate is outside the supported range")
            duration = frame_count / source_rate if source_rate else 0.0
            if duration < min_seconds:
                raise AudioValidationError(
                    f"audio must be at least {min_seconds:.2f} seconds long"
                )
            if duration > max_seconds:
                raise AudioValidationError(
                    f"audio must be no longer than {max_seconds:.2f} seconds"
                )
            frames = wav.readframes(frame_count)
    except (wave.Error, EOFError) as exc:
        raise AudioValidationError("body must be a valid PCM WAV file") from exc

    frame_width = channels * sample_width
    if len(frames) != frame_count * frame_width:
        raise AudioValidationError("WAV data is truncated")

    mono: list[float] = []
    for frame_offset in range(0, len(frames), frame_width):
        channel_values = []
        for channel in range(channels):
            offset = frame_offset + channel * sample_width
            channel_values.append(
                _decode_sample(frames[offset : offset + sample_width], sample_width)
            )
        mono.append(sum(channel_values) / channels)

    resampled = _resample_linear(mono, source_rate, target_sample_rate)
    return DecodedAudio(
        samples=tuple(resampled),
        sample_rate=target_sample_rate,
        duration_seconds=duration,
    )
