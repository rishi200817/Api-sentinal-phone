import { describe, expect, it } from "vitest";
import { detectFramework } from "@/lib/sentinel/parsers/framework";
import { planScan } from "@/lib/sentinel/parsers";

describe("framework detection", () => {
  it("detects express with reasons", () => {
    const d = detectFramework(
      new Map([
        ["package.json", JSON.stringify({ dependencies: { express: "^4.0.0" } })],
        ["a.js", `const express = require("express"); const r = express.Router();`],
      ])
    );
    expect(d.framework).toBe("express");
    expect(d.confidence).toBeGreaterThanOrEqual(0.34);
    expect(d.signals.length).toBeGreaterThan(0);
  });

  it("detects fastapi", () => {
    const d = detectFramework(
      new Map([
        ["requirements.txt", "fastapi==0.1\n"],
        ["a.py", `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/x")\ndef x(): ...`],
      ])
    );
    expect(d.framework).toBe("fastapi");
  });

  it("detects spring", () => {
    const d = detectFramework(
      new Map([
        ["pom.xml", "<artifactId>spring-boot-starter-web</artifactId>"],
        ["A.java", `import org.springframework.web.bind.annotation.*;\n@RestController\nclass A { @GetMapping("/x") String x(){return "";}}`],
      ])
    );
    expect(d.framework).toBe("spring");
  });

  it("reports unknown with threshold reason", () => {
    const d = detectFramework(new Map([["README.md", "# hi"]]));
    expect(d.framework).toBe("unknown");
    expect(d.reason).toMatch(/threshold|No recognized/i);
  });
});

describe("scan planning", () => {
  it("excludes dirs, lockfiles, binaries, and huge files", () => {
    const big = "x".repeat(600 * 1024);
    const plan = planScan(
      new Map([
        ["node_modules/a/index.js", "code"],
        ["package-lock.json", "{}"],
        ["img.png", "bindata"],
        ["big.js", big],
        ["src/a.js", "code"],
        ["openapi.yaml", "openapi: 3.0.0"],
      ])
    );
    expect(plan.analyzable.has("src/a.js")).toBe(true);
    expect(plan.openapiFiles.map((o) => o.file)).toEqual(["openapi.yaml"]);
    const reasons = Object.fromEntries(plan.ignored.map((i) => [i.file, i.reason]));
    expect(reasons["node_modules/a/index.js"]).toMatch(/excluded dir/);
    expect(reasons["package-lock.json"]).toMatch(/lockfile/);
    expect(reasons["img.png"]).toMatch(/binary/);
    expect(reasons["big.js"]).toMatch(/too large/);
  });

  it("detects NUL-byte binaries", () => {
    const plan = planScan(new Map([["a.js", "ab\0cd"]]));
    expect(plan.analyzable.size).toBe(0);
    expect(plan.ignored[0].reason).toMatch(/binary/);
  });
});

describe("consumer-only lane", () => {
  it("routes tests/docs/examples to consumer search, not contract extraction", async () => {
    const { planScan } = await import("@/lib/sentinel/parsers");
    const plan = planScan(
      new Map([
        ["src/app.py", "x = 1"],
        ["tests/test_app.py", "x = 1"],
        ["docs_src/demo.py", "x = 1"],
        ["examples/e.py", "x = 1"],
        ["src/a.test.ts", "x = 1"],
      ])
    );
    expect([...plan.analyzable.keys()]).toEqual(["src/app.py"]);
    expect(plan.consumerOnly.size).toBe(4);
    expect(plan.limits.consumerOnlyFiles).toBe(4);
  });
});
