/**
 * Built-in deterministic demo repository #2: Express API with nested routers.
 * v1 = baseline. v2 = new search endpoint, new required query param,
 * and auth newly required on user deletion.
 */

export const EXPRESS_V1: Record<string, string> = {
  "package.json": JSON.stringify(
    { name: "acme-orders", version: "2.1.0", dependencies: { express: "^4.19.2" } },
    null,
    2
  ),
  "src/server.js": `const express = require("express");
const apiRouter = require("./routes/api");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api", apiRouter);

app.listen(3000);
module.exports = app;
`,
  "src/routes/api.js": `const { Router } = require("express");
const authRouter = require("./auth");
const orderRouter = require("./orders");

const router = Router();
router.use("/auth", authRouter);
router.use("/orders", orderRouter);

module.exports = router;
`,
  "src/routes/auth.js": `const { Router } = require("express");

const router = Router();

// User login — returns a bearer token.
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "missing credentials" });
  return res.status(200).json({ token: "tok_123" });
});

module.exports = router;
`,
  "src/routes/orders.js": `const { Router } = require("express");

const router = Router();

// List orders.
router.get("/", (req, res) => {
  return res.status(200).json([]);
});

// Get a single order.
router.get("/:id", (req, res) => {
  return res.status(200).json({ id: req.params.id });
});

// Delete an order.
router.delete("/:id", (req, res) => {
  return res.status(204).end();
});

module.exports = router;
`,
  "web/src/api/orders.ts": `export async function listOrders() {
  const res = await fetch("/api/orders");
  return res.json();
}

export async function deleteOrder(id: string) {
  await fetch("/api/orders/" + id, { method: "DELETE" });
}
`,
};

export const EXPRESS_V2: Record<string, string> = {
  ...EXPRESS_V1,
  "src/routes/orders.js": `const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");

const router = Router();

// List orders, optionally filtered by status.
router.get("/", (req, res) => {
  const { status, page } = req.query;
  return res.status(200).json([]);
});

// Search orders by reference.
router.get("/search", requireAuth, (req, res) => {
  const { ref } = req.query;
  return res.status(200).json([]);
});

// Get a single order.
router.get("/:id", (req, res) => {
  return res.status(200).json({ id: req.params.id });
});

// Delete an order. Now requires authentication.
router.delete("/:id", requireAuth, (req, res) => {
  return res.status(204).end();
});

module.exports = router;
`,
  "src/middleware/auth.js": `function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "unauthorized" });
  return next();
}

module.exports = { requireAuth };
`,
};
