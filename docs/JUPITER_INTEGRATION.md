# Jupiter Swap API v2 integration

## Flow and trust boundary

The connected wallet supplies its public key as the Jupiter taker. The API requests a Swap API v2 `/order`, returns the transaction and order metadata, and the user reviews and signs the versioned transaction in their wallet. The API forwards the signed transaction and Jupiter request ID to `/execute`. The wallet-program vault is not involved. The server reads `JUPITER_API_KEY`; browser variables must never contain it.

## Network boundary

The initial development cluster is Solana Devnet. Jupiter swaps remain blocked on Devnet and localnet by both backend cluster validation and frontend cluster gating. Do not bypass either guard or silently switch networks. Jupiter execution is a separately controlled mainnet integration test that requires explicit mainnet configuration for both API and frontend and a server-side credential. Devnet wallet/API readiness results do not establish mainnet Jupiter readiness.

## Safety state and outstanding checks

- No live Jupiter quote or swap was attempted in this audit.
- API key is not configured in the inspected active runtime; no credential value is included here.
- A deterministic API regression test supplies a dummy server-side key and verifies that a Devnet quote returns `swap_network_unsupported` without making a Jupiter HTTP request.
- Verification command: `node tests/api/swap-network.test.js` — PASS, 1 test.
- Existing implementation checks basic request amounts, requested token pair and input amount, connected wallet inclusion, wallet signing, and Jupiter execution status. These checks do not yet prove transaction order association, signer requirements, quote expiry, signed transaction integrity, or duplicate execution resistance. Those remain focused follow-up audit/test work.
- Devnet swap rejection is expected behavior, not a failed wallet readiness check.
