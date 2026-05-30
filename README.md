# Chordynaut

Chordynaut is a mobile-first browser chord instrument with microphone sampling, loop/performance recording, fullscreen mobile handling, and Solana-ready provenance tools.

The instrument is designed to stay immediate: touch a chord, strum notes, sample a sound, record a piece, and optionally attach a local Solana wallet signature to the exported bundle.

## Why

Human-made music matters because timing, hesitation, phrasing, pressure, memory, and taste are not metadata fields. They are the reason a piece feels alive.

Blockchain should not pretend to create that human-ness. Chordynaut's Solana direction is to help record it:

- timestamp pieces made by real people
- preserve creator attribution and collaboration trails
- create collectible editions without hiding the human performance behind automation
- let musicians prove provenance while keeping the act of playing immediate

## Signed Bundles

Chordynaut now supports Solana wallet signatures without writing anything onchain.

The flow is intentionally narrow:

1. Connect a Solana wallet.
2. Record a performance or loop in Chordynaut.
3. Open the download panel and choose `sign bundle`.
4. Chordynaut exports a zip containing `audio.wav`, `performance.json`, and `receipt.json`.
5. Another Chordynaut instance can import that zip, recalculate the hashes, verify the wallet signature, and confirm which Solana address signed the piece.

This is not minting and it is not permanent onchain storage. It is a local cryptographic receipt: a Solana wallet attests to a specific Chordynaut export.
