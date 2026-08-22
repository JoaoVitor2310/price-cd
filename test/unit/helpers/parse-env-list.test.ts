import { describe, it, expect } from "vitest";
import { parseEnvList } from "@/helpers/parse-env-list.js";

describe("parseEnvList", () => {
    it("returns an empty list when the variable is undefined", () => {
        expect(parseEnvList(undefined)).toEqual([]);
    });

    it("returns an empty list for an empty string", () => {
        expect(parseEnvList("")).toEqual([]);
    });

    it("returns an empty list for a whitespace-only string", () => {
        expect(parseEnvList("   ")).toEqual([]);
    });

    it("reads a single value with no separator", () => {
        expect(parseEnvList("76561199999999999")).toEqual(["76561199999999999"]);
    });

    it("splits on commas", () => {
        expect(parseEnvList("76561199999999999,76561198888888888")).toEqual([
            "76561199999999999",
            "76561198888888888",
        ]);
    });

    it("trims whitespace around each value", () => {
        expect(parseEnvList(" 76561199999999999 , 76561198888888888 ")).toEqual([
            "76561199999999999",
            "76561198888888888",
        ]);
    });

    it("drops a trailing separator", () => {
        expect(parseEnvList("76561199999999999,")).toEqual(["76561199999999999"]);
    });

    it("drops empty entries between separators", () => {
        expect(parseEnvList("76561199999999999,,76561198888888888")).toEqual([
            "76561199999999999",
            "76561198888888888",
        ]);
    });

    it("also splits on semicolons and newlines", () => {
        expect(parseEnvList("a;b\nc")).toEqual(["a", "b", "c"]);
    });

    it("removes duplicates, keeping the first occurrence", () => {
        expect(parseEnvList("a,b,a")).toEqual(["a", "b"]);
    });
});
