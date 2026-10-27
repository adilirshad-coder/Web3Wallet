import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiService } from "@/services/apiService";

afterEach(() => vi.unstubAllGlobals());

describe("API response handling", () => {
  it("accepts an empty successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiService.health()).resolves.toBeUndefined();
  });

  it("preserves backend error codes and request IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "wallet_not_found", message: "Missing", requestId: "req-123" },
          }),
          { status: 404 },
        ),
      ),
    );
    await expect(apiService.getWallet("owner")).rejects.toMatchObject({
      status: 404,
      code: "wallet_not_found",
      requestId: "req-123",
    });
  });

  it("reports invalid JSON as a controlled API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 200 })),
    );
    await expect(apiService.health()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("classifies network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiService.health()).rejects.toBeInstanceOf(ApiError);
    await expect(apiService.health()).rejects.toMatchObject({ code: "network_error" });
  });
});
