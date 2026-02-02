# Copilot Instructions

## Project overview
- Astro (SSR in dev) single-page workflow for trimming reference audio and tail video from `dataset_meta.jsonl`.
- Server logic lives in API routes under `src/pages/api`.
- Server-only utilities live in `src/lib/server`.

## Local paths and safety
- All file access must stay under `LTX_ROOT` (default: `/home/ka/all-ref/MY_LTX-2`).
- `DATASET_META_PATH` can be used as the default dataset meta path when the UI does not provide one.

## Implementation notes
- Use `ffmpeg` for trimming audio/video.
- Use JSONL for dataset metadata; each line is a JSON object.
- Keep UI logic in `src/pages/index.astro` using vanilla JS (no framework).

## Checklist
- [x] Project scaffolded in /home/ka/all-ref/MY_LTX-2/gui
