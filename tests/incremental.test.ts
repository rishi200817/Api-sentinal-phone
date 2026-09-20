import { describe, expect, it } from "vitest";
import { planScan } from "@/lib/sentinel/parsers";
import { emptyParseCache, extractIncremental } from "@/lib/sentinel/parsers/incremental";
import { FASTAPI_V1, FASTAPI_V2 } from "@/lib/sentinel/demo/fastapi";
import { EXPRESS_V1, EXPRESS_V2 } from "@/lib/sentinel/demo/express";

describe("incremental extraction", () => {
  it("re-parses only changed files on second pass", () => {
    const first = extractIncremental(planScan(new Map(Object.entries(FASTAPI_V1))), emptyParseCache(), { forceFull: true });
    expect(first.endpoints.length).toBeGreaterThan(3);
    expect(first.framework.framework).toBe("fastapi");

    const second = extractIncremental(planScan(new Map(Object.entries(FASTAPI_V2))), first.cache);
    // only the two changed router files are re-scanned
    expect(second.reparsed.sort()).toEqual(["app/routers/auth.py", "app/routers/users.py"]);
    expect(second.reused.length).toBeGreaterThan(0);
    expect(second.endpoints.length).toBe(first.endpoints.length + 1); // + DELETE user
    expect(second.endpoints.map((e) => e.id)).toContain("DELETE /api/users/{user_id}");
  });

  it("extracts the demo login request fields", () => {
    const r = extractIncremental(planScan(new Map(Object.entries(FASTAPI_V2))), emptyParseCache(), { forceFull: true });
    const login = r.endpoints.find((e) => e.id === "POST /api/auth/login")!;
    expect(login.requestBody?.fields.map((f) => `${f.name}:${f.required}`)).toEqual([
      "username:true",
      "password:true",
      "deviceId:true",
    ]);
  });

  it("handles express nested mounts across versions", () => {
    const v1 = extractIncremental(planScan(new Map(Object.entries(EXPRESS_V1))), emptyParseCache(), { forceFull: true });
    expect(v1.endpoints.map((e) => e.id)).toContain("GET /api/orders/{id}");
    const v2 = extractIncremental(planScan(new Map(Object.entries(EXPRESS_V2))), v1.cache);
    expect(v2.endpoints.map((e) => e.id)).toContain("GET /api/orders/search");
    expect(v2.reused.length).toBeGreaterThan(0);
  });
});
