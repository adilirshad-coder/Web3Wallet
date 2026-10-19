# WalletWeb3 Client

This React/TanStack frontend connects to the existing WalletWeb3 Fastify API and Solana wallet program.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3271f49c-f835-40ce-b389-04970e3a08ba).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Local development (local validator)

Use Node.js 22.15.0 and npm 11.19.0. Copy `.env.example` to `.env.local` and keep its browser-visible `VITE_*` values free of secrets.

```powershell
Set-Location C:\WalletWeb3
npm.cmd ci
npm.cmd --prefix Client run dev
```

The default frontend RPC is `http://127.0.0.1:8899` and the declared cluster is `localnet`. The API defaults to the same RPC and cluster. Both can be changed deliberately, but the frontend wallet RPC and API RPC must address the same cluster. The checked in program ID is `DEh3BpiFuWwPZZFCPaBaY4HgvupL59JtgULsEF2HPSRL`.

The local validator does not automatically have the program deployed or initialized. Start `solana-test-validator`, build with the pinned Anchor/Solana toolchain, deploy the matching program keypair/artifact, and initialize the config PDA with an admin, treasury, verifier, and fee before `/readyz` can report ready. Do not use a mainnet wallet or public mainnet RPC for this workflow. Set the API's `SUBMIT_ENABLED=true` in the local backend environment only when ready to exercise local transactions.

From the repository root, start the API with `npm.cmd --workspace api start` after copying root `.env.example` to `api/.env` (the workspace script resolves `.env` relative to `api/`). Alternatively, from the root run `node --env-file=api/.env api/dist/server.js` after `npm.cmd run build`. PowerShell may block `npm.ps1`; use `npm.cmd` as shown.
