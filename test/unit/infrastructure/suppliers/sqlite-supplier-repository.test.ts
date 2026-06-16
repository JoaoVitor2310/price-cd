import { describe, it, expect } from "vitest";
import { SqliteSupplierRepository } from "@/infrastructure/suppliers/sqlite-supplier-repository.js";

function makeRepo() {
    return new SqliteSupplierRepository(":memory:");
}

describe("SqliteSupplierRepository", () => {
    describe("upsertSupplier", () => {
        it("creates a new supplier and returns an id", () => {
            const repo = makeRepo();
            const id = repo.upsertSupplier("76561199000000001");
            expect(typeof id).toBe("number");
            expect(id).toBeGreaterThan(0);
        });

        it("returns the same id when called twice with the same steam_id", () => {
            const repo = makeRepo();
            const id1 = repo.upsertSupplier("76561199000000001");
            const id2 = repo.upsertSupplier("76561199000000001");
            expect(id1).toBe(id2);
        });
    });

    describe("findSupplierBySteamId", () => {
        it("returns null when supplier does not exist", () => {
            const repo = makeRepo();
            expect(repo.findSupplierBySteamId("nonexistent")).toBeNull();
        });

        it("returns the supplier after upsert", () => {
            const repo = makeRepo();
            repo.upsertSupplier("76561199000000002");
            const supplier = repo.findSupplierBySteamId("76561199000000002");
            expect(supplier).not.toBeNull();
            expect(supplier?.steam_id).toBe("76561199000000002");
            expect(supplier?.is_added).toBe(0);
        });
    });

    describe("saveTopic", () => {
        it("persists topic with all fields without throwing", () => {
            const repo = makeRepo();
            const supplierId = repo.upsertSupplier("76561199000000003");
            expect(() =>
                repo.saveTopic({ supplier_id: supplierId, code: "CCC33", status: "not_profitable", result: null })
            ).not.toThrow();
        });

        it("throws on duplicate topic code", () => {
            const repo = makeRepo();
            const supplierId = repo.upsertSupplier("76561199000000004");
            repo.saveTopic({ supplier_id: supplierId, code: "DDD44", status: "inactive", result: null });
            expect(() =>
                repo.saveTopic({ supplier_id: supplierId, code: "DDD44", status: "inactive", result: null })
            ).toThrow();
        });
    });
});
