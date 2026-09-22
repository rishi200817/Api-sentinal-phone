import { describe, expect, it } from "vitest";
import { parseExpressFiles } from "@/lib/sentinel/parsers/express";

const NESTED = new Map<string, string>([
  ["package.json", JSON.stringify({ dependencies: { express: "^4.0.0" } })],
  [
    "src/server.js",
    `const express = require("express");
const api = require("./routes/api");
const app = express();
app.use("/api", api);
app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(3000);`,
  ],
  [
    "src/routes/api.js",
    `const { Router } = require("express");
const users = require("./users");
const router = Router();
router.use("/users", users);
module.exports = router;`,
  ],
  [
    "src/routes/users.js",
    `const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const router = Router();
// Get a user by id.
router.get("/:id", requireAuth, (req, res) => {
  const { verbose } = req.query;
  return res.status(200).json({ id: 1 });
});
router.post("/", (req, res) => {
  const { name, email } = req.body;
  return res.status(201).json({ id: 2 });
});
module.exports = router;`,
  ],
  [
    "src/middleware/auth.js",
    `function requireAuth(req, res, next) { return next(); }
module.exports = { requireAuth };`,
  ],
]);

describe("express parser", () => {
  it("resolves nested router mounts to full paths", () => {
    const { endpoints } = parseExpressFiles(NESTED);
    const ids = endpoints.map((e) => e.id).sort();
    expect(ids).toContain("GET /api/users/{id}");
    expect(ids).toContain("POST /api/users");
    expect(ids).toContain("GET /health");
  });

  it("infers path params, query params, and body fields", () => {
    const { endpoints } = parseExpressFiles(NESTED);
    const get = endpoints.find((e) => e.id === "GET /api/users/{id}")!;
    expect(get.pathParams.map((p) => p.name)).toContain("id");
    expect(get.queryParams.map((p) => p.name)).toContain("verbose");
    expect(get.auth.required).toBe(true);
    const post = endpoints.find((e) => e.id === "POST /api/users")!;
    expect(post.requestBody?.fields.map((f) => f.name).sort()).toEqual(["email", "name"]);
    expect(post.responses.map((r) => r.status)).toContain("201");
  });

  it("captures source file, line, and comments", () => {
    const { endpoints } = parseExpressFiles(NESTED);
    const get = endpoints.find((e) => e.id === "GET /api/users/{id}")!;
    expect(get.sourceFile).toBe("src/routes/users.js");
    expect(get.sourceLine).toBeGreaterThan(0);
    expect(get.description ?? get.summary).toMatch(/user by id/i);
  });

  it("ignores non-router verb calls like axios.get", () => {
    const files = new Map<string, string>([
      ["client.js", `axios.get("/api/users"); fetch("/x");`],
    ]);
    const { endpoints } = parseExpressFiles(files);
    expect(endpoints).toHaveLength(0);
  });

  it("handles .route() chains", () => {
    const files = new Map<string, string>([
      [
        "r.js",
        `const express = require("express");
const router = express.Router();
router.route("/things").get((req, res) => res.json([])).post((req, res) => res.status(201).end());
module.exports = router;`,
      ],
    ]);
    const { endpoints } = parseExpressFiles(files);
    expect(endpoints.map((e) => e.id).sort()).toEqual(["GET /things", "POST /things"]);
  });
});

describe("express red-team patterns", () => {
  const BOILERPLATE = new Map<string, string>([
    ["src/app.js", `const express = require("express");
const routes = require("./routes/v1");
const app = express();
app.use("/v1", routes);
app.options("*", (req, res) => res.sendStatus(204));`],
    ["src/routes/v1/index.js", `const express = require("express");
const authRoute = require("./auth.route");
const router = express.Router();
const defaultRoutes = [{ path: "/auth", route: authRoute }];
defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});
module.exports = router;`],
    ["src/routes/v1/auth.route.js", `const express = require("express");
const router = express.Router();
router.post("/login", (req, res) => res.json({}));
router.post("/send-verification-email", auth(), (req, res) => res.json({}));
module.exports = router;`],
  ]);

  it("resolves config-array mounts across files", async () => {
    const { parseExpressFiles } = await import("@/lib/sentinel/parsers/express");
    const { endpoints } = parseExpressFiles(BOILERPLATE);
    expect(endpoints.map((e) => e.id).sort()).toEqual([
      "POST /v1/auth/login",
      "POST /v1/auth/send-verification-email",
    ]);
  });

  it("detects call-expression auth middleware and skips wildcards", async () => {
    const { parseExpressFiles } = await import("@/lib/sentinel/parsers/express");
    const { endpoints } = parseExpressFiles(BOILERPLATE);
    const v = endpoints.find((e) => e.id === "POST /v1/auth/send-verification-email")!;
    expect(v.auth.required).toBe(true);
    expect(endpoints.some((e) => e.path.includes("*"))).toBe(false);
  });

  it("handles multi-line fluent chains", async () => {
    const { parseExpressFiles } = await import("@/lib/sentinel/parsers/express");
    const files = new Map<string, string>([
      ["r.js", `const express = require("express");
const router = express.Router();
router
  .route("/")
  .post(auth("manageUsers"), (req, res) => res.status(201).end())
  .get(auth("getUsers"), (req, res) => res.json([]));
module.exports = router;`],
    ]);
    const { endpoints } = parseExpressFiles(files);
    expect(endpoints.map((e) => e.id).sort()).toEqual(["GET /", "POST /"]);
    expect(endpoints.every((e) => e.auth.required)).toBe(true);
  });
});

describe("express handler vs guard", () => {
  it("does not mistake controllers for auth guards", async () => {
    const { parseExpressFiles } = await import("@/lib/sentinel/parsers/express");
    const files = new Map<string, string>([
      ["r.js", `const express = require("express");
const router = express.Router();
router.post("/login", validate(x.login), authController.login);
router.get("/me", requireAuth, userController.me);
router.get("/open", someHandler);
module.exports = router;`],
    ]);
    const { endpoints } = parseExpressFiles(files);
    const byId = Object.fromEntries(endpoints.map((e) => [e.id, e.auth.required]));
    expect(byId).toEqual({
      "POST /login": false,
      "GET /me": true,
      "GET /open": false,
    });
  });
});
