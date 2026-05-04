# Chordysol

Chordysol is a cosmetic fork of Chordynaut prepared for Solana integration.

The instrument still works like the original browser chord synthesizer. This first pass does not change the music engine, performance controls, loop behavior, microphone sampling, or export flow. It rebrands the site for `chordysol.github.io`, adds Solana visual treatment, and frames the project as a human-first music tool that can later write provenance to Solana.

## Why

Human-made music matters because timing, hesitation, phrasing, pressure, memory, and taste are not metadata fields. They are the reason a piece feels alive.

Blockchain should not pretend to create that human-ness. Chordysol's Solana direction is to help record it:

- timestamp pieces made by real people
- preserve creator attribution and collaboration trails
- create collectible editions without hiding the human performance behind automation
- let musicians prove provenance while keeping the act of playing immediate

## Fork Note

Chordysol is forked from Chordynaut to integrate Solana. The current release is intentionally cosmetic so the instrument remains stable before wallet, minting, attribution, or onchain receipt features are added.

## Signed Bundles

Chordysol now supports Solana wallet signatures without writing anything onchain.

The flow is intentionally narrow:

1. Connect a Solana wallet.
2. Record a performance or loop in Chordysol.
3. Open the download panel and choose `sign bundle`.
4. Chordysol exports a zip containing `audio.wav`, `performance.json`, and `receipt.json`.
5. Another Chordysol instance can import that zip, recalculate the hashes, verify the wallet signature, and confirm which Solana address signed the piece.

This is not minting and it is not permanent onchain storage. It is a local cryptographic receipt: a Solana wallet attests to a specific Chordysol export.
