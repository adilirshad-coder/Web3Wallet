import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connected: false,
  publicKey: null as null | { toBase58: () => string },
  signTransaction: null as null | ((tx: unknown) => Promise<unknown>),
  setVisible: vi.fn(),
  getBalance: vi.fn().mockResolvedValue(1_000_000_000),
  getSignaturesForAddress: vi.fn().mockResolvedValue([]),
  connection: null as null | { getBalance: () => Promise<number>; getSignaturesForAddress: () => Promise<never[]> },
  health: vi.fn(),
  ready: vi.fn(),
  getConfig: vi.fn(),
  getWallet: vi.fn(),
  getBalances: vi.fn(),
  buildSignSubmit: vi.fn(),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection: mocks.connection }),
  useWallet: () => ({ connected: mocks.connected, publicKey: mocks.publicKey, signTransaction: mocks.signTransaction }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: mocks.setVisible }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: unknown }) => children }));
vi.mock("@/lib/tx", () => ({
  buildSignSubmit: mocks.buildSignSubmit,
  friendlyError: (e: unknown) => e instanceof Error ? e.message : "Unexpected error",
}));
vi.mock("@/services/apiService", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  },
  apiService: {
    health: mocks.health,
    ready: mocks.ready,
    getConfig: mocks.getConfig,
    getWallet: mocks.getWallet,
    getBalances: mocks.getBalances,
  },
}));

import { Dashboard } from "@/components/Dashboard";
import { ApiError } from "@/services/apiService";

const config = {
  programId: "DEh3BpiFuWwPZZFCPaBaY4HgvupL59JtgULsEF2HPSRL",
  cluster: "localnet",
  feeBps: 25,
  maxFeeBps: 100,
  maxSlippageBps: 500,
  paused: false,
  treasury: "11111111111111111111111111111111",
  rentExemptMinZeroData: "890880",
};
const existingWallet = {
  exists: true,
  walletPda: "wallet-pda",
  solVault: "sol-vault",
  verification: { status: "unverified", level: 0, expiresAt: null },
  createdAt: null,
};
const balances = { sol: { lamports: "0", uiAmountString: "0" }, tokens: [] };
const missingWallet = () => new ApiError(404, "wallet_not_found", "The wallet was not found");

function prepareWallet() {
  mocks.connected = true;
  mocks.publicKey = { toBase58: () => "owner-public-key" };
  mocks.signTransaction = async (tx) => tx;
  mocks.health.mockResolvedValue({ status: "ok" });
  mocks.ready.mockResolvedValue({ status: "ready" });
  mocks.getConfig.mockResolvedValue(config);
  mocks.getWallet.mockRejectedValue(missingWallet());
  mocks.getBalances.mockResolvedValue(balances);
  mocks.buildSignSubmit.mockImplementation(async (_build, _sign, progress) => {
    progress("Confirming…");
    return "confirmed-signature";
  });
}

beforeEach(() => {
  mocks.connected = false;
  mocks.publicKey = null;
  mocks.signTransaction = null;
  for (const fn of [mocks.health, mocks.ready, mocks.getConfig, mocks.getWallet, mocks.getBalances, mocks.buildSignSubmit]) fn.mockReset();
  mocks.getBalance.mockResolvedValue(1_000_000_000);
  mocks.getSignaturesForAddress.mockResolvedValue([]);
  mocks.connection = { getBalance: mocks.getBalance, getSignaturesForAddress: mocks.getSignaturesForAddress };
});
afterEach(cleanup);

describe("Dashboard smart-wallet creation", () => {
  it("shows the connect action while disconnected", async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));
    expect(mocks.setVisible).toHaveBeenCalledWith(true);
  });

  it("offers creation only for the backend's wallet_not_found response", async () => {
    prepareWallet();
    render(<Dashboard />);
    const button = await screen.findByRole("button", { name: "Create Smart Wallet" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(mocks.buildSignSubmit).not.toHaveBeenCalled();
  });

  it("builds, signs, submits, confirms, and reloads the wallet", async () => {
    prepareWallet();
    mocks.getWallet.mockRejectedValueOnce(missingWallet()).mockResolvedValueOnce(existingWallet);
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Smart Wallet" }));
    expect(await screen.findByText("Smart wallet created")).toBeInTheDocument();
    expect(mocks.buildSignSubmit).toHaveBeenCalledOnce();
    expect(mocks.buildSignSubmit.mock.calls[0]?.[0]).toBeTypeOf("function");
    expect(mocks.buildSignSubmit.mock.calls[0]?.[1]).toBe(mocks.signTransaction);
    expect(mocks.getBalances).toHaveBeenCalled();
    expect(await screen.findByText("PDA:", { exact: false })).toBeInTheDocument();
  });

  it("treats a concurrent already-created response idempotently", async () => {
    prepareWallet();
    mocks.getWallet.mockRejectedValueOnce(missingWallet()).mockResolvedValueOnce(existingWallet);
    mocks.buildSignSubmit.mockRejectedValue(new ApiError(409, "wallet_already_exists", "The wallet already exists"));
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Smart Wallet" }));
    expect(await screen.findByText("Smart wallet already exists")).toBeInTheDocument();
    expect(mocks.getWallet).toHaveBeenCalledTimes(2);
  });

  it("reports wallet-signing rejection without success", async () => {
    prepareWallet();
    mocks.buildSignSubmit.mockRejectedValue(new Error("User rejected the request"));
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Smart Wallet" }));
    expect(await screen.findByText("User rejected the request")).toBeInTheDocument();
    expect(screen.queryByText("Smart wallet created")).not.toBeInTheDocument();
  });

  it("keeps creation unavailable when the API is offline", async () => {
    prepareWallet();
    mocks.health.mockRejectedValue(new Error("offline"));
    mocks.getWallet.mockRejectedValue(new Error("offline"));
    render(<Dashboard />);
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Smart Wallet" })).not.toBeInTheDocument();
  });

  it("does not treat an unrelated 404 as a missing wallet", async () => {
    prepareWallet();
    mocks.getWallet.mockRejectedValue(new ApiError(404, "account_not_found", "A different account was not found"));
    render(<Dashboard />);
    expect(await screen.findByText("A different account was not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Smart Wallet" })).not.toBeInTheDocument();
  });

  it("reports failed or timed-out confirmation without success", async () => {
    prepareWallet();
    mocks.buildSignSubmit.mockRejectedValue(new Error("Transaction was not confirmed in time"));
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Smart Wallet" }));
    expect(await screen.findByText("Transaction was not confirmed in time")).toBeInTheDocument();
    expect(screen.queryByText("Smart wallet created")).not.toBeInTheDocument();
  });
});
