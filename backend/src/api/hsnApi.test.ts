import { beforeEach, describe, expect, it, vi } from "vitest";
import { addHsn, deleteHsn, updateHsn } from "./hsnApi";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("hsnApi", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "test-token");
    vi.restoreAllMocks();
  });

  it("sends JSON and auth headers when creating an HSN code", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: "HSN-1" }));

    await addHsn({ code: "9983", description: "Services" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hsn",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({ code: "9983", description: "Services" }),
      }),
    );
  });

  it("sends JSON and auth headers when updating an HSN code", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: "HSN-1" }));

    await updateHsn("9983", { description: "Updated" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hsn/9983",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({ description: "Updated" }),
      }),
    );
  });

  it("keeps auth on delete requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ deleted: true }));

    await deleteHsn("9983");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hsn/9983",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
      }),
    );
  });

  it("throws the backend error message when create fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "Duplicate HSN code" }, 409),
    );

    await expect(addHsn({ code: "9983" })).rejects.toThrow(
      "Duplicate HSN code",
    );
  });
});
