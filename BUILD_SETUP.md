# Local workflow (PowerShell)

From `C:\WalletWeb3`, install JavaScript dependencies with `npm.cmd ci`. Copy `.env.example` to `api\.env` and `Client\.env.example` to `Client\.env.local`; these examples point both clients to localnet (`http://127.0.0.1:8899`). Browser `VITE_*` settings are public and must never contain secrets.

A local validator starts empty. Install the versions listed above, then in PowerShell run `solana-test-validator --reset` in its own terminal, followed by `anchor build` and `anchor deploy --provider.cluster localnet`. The deploy keypair must derive the checked-in program ID; do not generate a replacement identity to make deployment pass. Initialize the config PDA with the program's `initialize_config` admin instruction before starting the API. There is no checked-in config initialization command, so it must be submitted by an authorized admin using an Anchor client/script. The API will return not ready until RPC and config are available. Only enable `SUBMIT_ENABLED=true` in a disposable local test environment after deployment and initialization.

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

The Swap page uses Jupiter Swap API v2 through the backend: `/v1/swap/quote` creates a fresh order, the connected wallet signs it, and `/v1/tx/swap` sends it to Jupiter `/execute` for landing and confirmation. `JUPITER_API_KEY` belongs only in `api/.env`; never put it in a `VITE_*` variable. Set `CLUSTER=mainnet-beta` in `api/.env`, `VITE_SOLANA_CLUSTER=mainnet-beta` and a mainnet RPC URL in `Client/.env.local` to use swaps. The UI blocks orders when its configured cluster is localnet/devnet. Jupiter swap transactions execute from the connected wallet; they do not spend from or credit the program managed vault. The Anchor vault swap instruction is still unavailable. The shipped local validator does not include Jupiter, so no localnet swap can execute.

The API binds to `127.0.0.1:3000` by default and accepts browser origins listed in `CORS_ORIGINS`. For same-machine Vite use, allow `http://localhost:5173` and `http://127.0.0.1:5173`. If the frontend and API run on different machines or in separate containers, set `VITE_API_BASE_URL` to an address reachable from the browser and bind the API to a reachable interface; `localhost` always means the browser's own device. The start script requires `api/.env`, while Vite reads `Client/.env.local`; create them from the checked-in examples before starting either process.
