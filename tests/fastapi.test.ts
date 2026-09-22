import { describe, expect, it } from "vitest";
import { parseFastApiFiles } from "@/lib/sentinel/parsers/fastapi";

const APP = new Map<string, string>([
  [
    "app/main.py",
    `from fastapi import FastAPI
from app.routers import items
app = FastAPI()
app.include_router(items.router, prefix="/api")`,
  ],
  [
    "app/routers/items.py",
    `from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

router = APIRouter(prefix="/items")

class ItemIn(BaseModel):
    name: str
    price: float
    note: str = "n/a"

class Item(ItemIn):
    id: int

def get_current_user():
    return {}

@router.post("/", response_model=Item, status_code=201, summary="Create item")
def create_item(body: ItemIn, user=Depends(get_current_user)):
    """Create an item."""
    return {}

@router.get("/{item_id}")
def read_item(item_id: int, q: str = Query(default="")):
    return {}
`,
  ],
]);

describe("fastapi parser", () => {
  it("extracts routes with router prefixes", () => {
    const { endpoints } = parseFastApiFiles(APP);
    const ids = endpoints.map((e) => e.id).sort();
    expect(ids).toEqual(["GET /api/items/{item_id}", "POST /api/items"]);
  });

  it("resolves Pydantic request models with required flags", () => {
    const { endpoints } = parseFastApiFiles(APP);
    const post = endpoints.find((e) => e.id === "POST /api/items")!;
    const fields = Object.fromEntries(
      (post.requestBody?.fields ?? []).map((f) => [f.name, f.required])
    );
    expect(fields).toEqual({ name: true, price: true, note: false });
    expect(post.requestBody?.confidence).toBe("detected");
  });

  it("resolves response_model and status codes", () => {
    const { endpoints } = parseFastApiFiles(APP);
    const post = endpoints.find((e) => e.id === "POST /api/items")!;
    expect(post.responses[0].status).toBe("201");
    expect(post.responses[0].fields.map((f) => f.name)).toContain("id");
  });

  it("detects dependency-based auth and path/query params", () => {
    const { endpoints } = parseFastApiFiles(APP);
    const post = endpoints.find((e) => e.id === "POST /api/items")!;
    expect(post.auth.required).toBe(true);
    const get = endpoints.find((e) => e.id === "GET /api/items/{item_id}")!;
    expect(get.pathParams.map((p) => p.name)).toEqual(["item_id"]);
    expect(get.queryParams.map((p) => p.name)).toContain("q");
  });
});

describe("fastapi async handlers", () => {
  it("extracts async def routes with params", async () => {
    const { parseFastApiFiles } = await import("@/lib/sentinel/parsers/fastapi");
    const files = new Map<string, string>([
      ["app.py", `from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/items/{item_id}")\nasync def read_item(item_id: int):\n    return {}\n`],
    ]);
    const { endpoints } = parseFastApiFiles(files);
    expect(endpoints.map((e) => e.id)).toEqual(["GET /items/{item_id}"]);
    expect(endpoints[0].pathParams.map((p) => p.name)).toEqual(["item_id"]);
  });
});
