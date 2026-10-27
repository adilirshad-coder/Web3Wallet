# Frontend/backend contract map

The TypeScript client contract is in `Client/src/services/apiService.ts`; server schemas and routes are in `api/src/routes/`. Amounts and lamports are decimal strings to avoid JavaScript precision loss. Successful unsigned transaction builders return base64 version-0 transactions for the connected wallet to review and sign. API errors use `{ error: { code, message, requestId, details? } }`.

| Client method / flow | HTTP contract | Authentication / idempotency | Verification status |
| --- | --- | --- | --- |
| `health`, `ready` | `GET /healthz`, `GET /readyz` | None | Route/schema covered by API inject tests; live Devnet readiness blocked because program account is absent |
| `getConfig` | `GET /v1/config` | None | Route/schema unit-covered; Devnet config PDA unavailable |
| `getWallet`, `getBalances`, `getReceive` | `GET /v1/wallets/:owner[/(balances\|receive)]` | None | API fake-RPC route tests; not live-chain verification |
| `quoteFee` | `POST /v1/quotes/fee` `{kind, amount}` | None | API unit tests; amount is a decimal-string u64 |
| `buildCreateWallet`, `buildSendSol`, `buildSendToken`, `buildRequestVerification` | `POST /v1/tx/*` with owner/recipient/mint/amount as applicable | None; returns unsigned v0 base64 | API fake-RPC builder tests and on-chain local-validator suite; local suite 55/58, details in baseline audit |
| `submit` | `POST /v1/tx/submit` `{signedTransaction}` | `Idempotency-Key`; `SUBMIT_ENABLED` gate | Remains disabled on Devnet until deployment/config/validation verification |
| `getStatus`, `waitForStatus` | `GET /v1/tx/:signature` | None; client polls until terminal status or timeout | API route unit-tested; live Devnet transaction flow not verified |
| `challenge`, `verify` | `POST /v1/auth/challenge`, `/v1/auth/verify` | Wallet signs one-time challenge; verify returns bearer token | API unit tests; wallet UI integration not run against live API |
| `createVerificationSession`, `createOnrampSession` | `POST /v1/verification/session`, `/v1/onramp/sessions` | Bearer session and idempotency key | Disabled provider boundaries; no provider call readiness claim |
| `getSwapOrder`, `executeSwap` | `POST /v1/swap/quote`, `/v1/tx/swap` | Connected wallet taker/signature; server-side Jupiter key | Devnet blocked by regression test. Controlled mainnet flow not run. |

The wallet creation UI is intended to offer creation only after an API `wallet_not_found` result; API/offline/readiness failures are separate error states. Existing dashboard tests cover wallet-flow decision logic. Full browser-to-live-Devnet checks remain unavailable until the program is deployed and initialized and the API runs against that cluster.

## Independent readiness tracks

- **Devnet wallet/API:** defaults and public settings align; the API builds; focused config assertions pass; the program account lookup returned `AccountNotFound`. Deployment, config PDA, readiness endpoint, and signed transactions are therefore not verified. Keep submission disabled.
- **Mainnet Jupiter:** the server-side API key is absent in the active runtime; no live quote, signing or execution was performed. Devnet blocking is tested independently and has no dependency on mainnet integration success.
