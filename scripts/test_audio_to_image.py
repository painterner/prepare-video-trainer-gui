#!/usr/bin/env python3
"""Audio → 24-bit RGB waveform image.

Usage:
    python scripts/test_audio_to_image.py <audio_file> [--size 512] [--sr 16000]

Outputs in the same directory as the input audio:
    - *_waveform.png     : the encoded image
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torchaudio


def audio_to_image(wav: np.ndarray, width: int, height: int) -> np.ndarray:
    """Encode mono waveform [-1,1] into 24-bit RGB image. Returns (H, W, 3) uint8."""
    total_pixels = width * height
    n = len(wav)

    if n == total_pixels:
        flat = wav.copy()
    elif n < total_pixels:
        flat = np.zeros(total_pixels, dtype=np.float32)
        flat[:n] = wav
    else:
        x_old = np.linspace(0, 1, n)
        x_new = np.linspace(0, 1, total_pixels)
        flat = np.interp(x_new, x_old, wav).astype(np.float32)

    values = np.clip((flat + 1.0) / 2.0, 0.0, 1.0)
    int24 = (values * (2**24 - 1)).astype(np.uint32)

    canvas = np.zeros((total_pixels, 3), dtype=np.uint8)
    canvas[:, 0] = ((int24 >> 16) & 0xFF).astype(np.uint8)
    canvas[:, 1] = ((int24 >> 8) & 0xFF).astype(np.uint8)
    canvas[:, 2] = (int24 & 0xFF).astype(np.uint8)

    return canvas.reshape(height, width, 3)


def main():
    parser = argparse.ArgumentParser(description="Audio → 24-bit RGB waveform image")
    parser.add_argument("audio_file", help="Input audio file (wav/mp3/etc)")
    parser.add_argument("--size", type=int, default=512, help="Image width & height (default: 512)")
    parser.add_argument("--sr", type=int, default=16000, help="Target sample rate (default: 16000)")
    args = parser.parse_args()

    audio_path = Path(args.audio_file).expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    out_dir = audio_path.parent
    stem = audio_path.stem
    width = height = args.size
    total_pixels = width * height

    # --- Load audio ---
    waveform, sr = torchaudio.load(str(audio_path))
    if sr != args.sr:
        waveform = torchaudio.functional.resample(waveform, sr, args.sr)
        sr = args.sr
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    wav_orig = waveform.squeeze(0).numpy()

    print(f"Audio: {audio_path.name}")
    print(f"  Sample rate: {sr} Hz")
    print(f"  Duration: {len(wav_orig)/sr:.2f}s")
    print(f"  Samples: {len(wav_orig):,}")
    print(f"  Range: [{wav_orig.min():.6f}, {wav_orig.max():.6f}]")
    print(f"  Image: {width}x{height} = {total_pixels:,} pixels")
    print()

    # --- Encode ---
    img = audio_to_image(wav_orig, width, height)

    from PIL import Image
    img_pil = Image.fromarray(img, mode="RGB")
    img_path = out_dir / f"{stem}_waveform.png"
    img_pil.save(str(img_path))
    print(f"Saved encoded image: {img_path}")


if __name__ == "__main__":
    main()
