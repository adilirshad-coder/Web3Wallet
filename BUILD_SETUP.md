# Devnet workflow (PowerShell)

From `C:\WalletWeb3`, install JavaScript dependencies with `npm.cmd ci`. Copy `.env.example` to `api\.env` and `Client\.env.example` to `Client\.env.local`; these examples point both clients to Solana Devnet. Browser `VITE_*` settings are public and must never contain secrets.

The Devnet endpoint and current program identity are configured for read-only readiness work. The existing program is not verified as deployed or initialized on Devnet; leave `SUBMIT_ENABLED=false`. Before enabling submissions, deploy the existing artifact with the matching identity, initialize and verify its config PDA, and run transaction validation checks. Do not generate a replacement identity. Local validator tests remain separate and use an empty local validator.

In terminal 1, from the repository root:

```powershell
npm --workspace api start
```

This workspace script loads `api\.env` because Node resolves `--env-file=.env` from the API workspace working directory. To launch the compiled API directly from the root instead, use:

```powershell
node --env-file=api/.env api/dist/server.js
```

In terminal 2:

```powershell
npm --prefix Client run dev
```

The PowerShell execution policy on some Windows systems blocks `npm.ps1`; use `npm.cmd` in that case. Run frontend checks with `npm.cmd --prefix Client test`, `npm.cmd --prefix Client run build`, and `npm.cmd --prefix Client run lint`; run backend checks with `npm.cmd run build`, `npm.cmd test`, and `npm.cmd run test:rust`.

Checks: `npm --prefix Client test`, `npm --prefix Client run build`, `npm --prefix Client run lint`, `npm run build`, `npm test`, and `npm run test:rust`. Local-validator integration is separate: with the matching program deployed on the running local validator, run `npm run test:program`. These steps do not target devnet or mainnet.

## Swap support

The Swap page retains Jupiter Swap API v2 for a separately controlled mainnet integration test: `/v1/swap/quote` creates a fresh order from the connected wallet, the wallet signs it, and `/v1/tx/swap` sends it to Jupiter `/execute`. `JUPITER_API_KEY` belongs only in `api/.env`; never put it in a `VITE_*` variable. Devnet/localnet requests are blocked. For a controlled mainnet test, set both API and frontend cluster/RPC values explicitly to mainnet and use a server-side Jupiter key. Jupiter transactions use the connected wallet; they do not spend from or credit the program managed vault. The Anchor vault swap instruction remains unavailable. Devnet wallet/API readiness checks are separate from mainnet Jupiter execution checks.

The API binds to `127.0.0.1:3000` by default and accepts browser origins listed in `CORS_ORIGINS`. For same-machine Vite use, allow `http://localhost:5173` and `http://127.0.0.1:5173`. If the frontend and API run on different machines or in separate containers, set `VITE_API_BASE_URL` to an address reachable from the browser and bind the API to a reachable interface; `localhost` always means the browser's own device. The start script requires `api/.env`, while Vite reads `Client/.env.local`; create them from the checked-in examples before starting either process.
