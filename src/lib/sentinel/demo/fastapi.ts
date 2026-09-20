/**
 * Built-in deterministic demo repository #1: FastAPI auth service.
 * v1 = healthy baseline. v2 = developer adds required `deviceId` to login
 * and a new DELETE /api/users/{user_id} endpoint.
 * Both versions run through the REAL pipeline — nothing is hardcoded.
 */

export const FASTAPI_V1: Record<string, string> = {
  "requirements.txt": "fastapi==0.115.0\nuvicorn==0.30.6\npydantic==2.9.0\n",
  "app/main.py": `from fastapi import FastAPI

from app.routers import auth, users

app = FastAPI(title="Acme Auth API", version="1.4.0")


@app.get("/health", summary="Health check")
def health():
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
`,
  "app/routers/auth.py": `from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_in: int


def get_current_user(token: str = ""):
    return {"sub": "demo"}


@router.post("/login", response_model=LoginResponse, summary="User login")
def login(body: LoginRequest):
    """Authenticate a user and return a bearer token."""
    return {"token": "tok_123", "expires_in": 3600}


@router.get("/me", summary="Current user")
def me(user=Depends(get_current_user)):
    """Return the current authenticated user."""
    return user
`,
  "app/routers/users.py": `from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    name: str
    email: str


class User(BaseModel):
    id: int
    name: str
    email: str


@router.get("/", summary="List users")
def list_users():
    """Return all users."""
    return []


@router.get("/{user_id}", response_model=User, summary="Get user")
def get_user(user_id: int):
    """Return a single user by id."""
    return {"id": user_id, "name": "Ada", "email": "ada@acme.dev"}


@router.post("/", response_model=User, status_code=201, summary="Create user")
def create_user(body: UserCreate):
    """Create a new user."""
    return {"id": 7, "name": body.name, "email": body.email}
`,
  "web/src/api/auth.ts": `// Web client — login consumer (impact analysis should find this).
export async function login(username: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("login failed");
  return res.json();
}
`,
  "mobile/src/services/auth.ts": `// Mobile client — login consumer.
import { http } from "../http";

export function loginRequest(username: string, password: string) {
  return http.post("/api/auth/login", { username, password });
}
`,
  "openapi.yaml": `openapi: 3.0.3
info:
  title: Acme Auth API
  version: 1.4.0
  description: Baseline specification, synchronized with v1 source.
servers:
  - url: https://api.acme.dev
paths:
  /health:
    get:
      summary: Health check
      operationId: get_health
      responses:
        '200':
          description: Success
  /api/auth/login:
    post:
      summary: User login
      description: Authenticate a user and return a bearer token.
      operationId: post_api_auth_login
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                username:
                  type: string
                password:
                  type: string
              required:
                - username
                - password
      responses:
        '201':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  token:
                    type: string
                  expires_in:
                    type: integer
  /api/auth/me:
    get:
      summary: Current user
      operationId: get_api_auth_me
      responses:
        '200':
          description: Success
  /api/users:
    get:
      summary: List users
      operationId: get_api_users
      responses:
        '200':
          description: Success
    post:
      summary: Create user
      operationId: post_api_users
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                email:
                  type: string
      responses:
        '201':
          description: Success
  /api/users/{user_id}:
    get:
      summary: Get user
      operationId: get_api_users_user_id
      parameters:
        - name: user_id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: Success
`,
};

export const FASTAPI_V2: Record<string, string> = {
  ...FASTAPI_V1,
  "app/routers/auth.py": `from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str
    deviceId: str


class LoginResponse(BaseModel):
    token: str
    expires_in: int


def get_current_user(token: str = ""):
    return {"sub": "demo"}


@router.post("/login", response_model=LoginResponse, summary="User login")
def login(body: LoginRequest):
    """Authenticate a user and return a bearer token.

    Now binds the session to the caller's device.
    """
    return {"token": "tok_123", "expires_in": 3600}


@router.get("/me", summary="Current user")
def me(user=Depends(get_current_user)):
    """Return the current authenticated user."""
    return user
`,
  "app/routers/users.py": `from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/users", tags=["users"])


def get_current_user(token: str = ""):
    return {"sub": "demo"}


class UserCreate(BaseModel):
    name: str
    email: str


class User(BaseModel):
    id: int
    name: str
    email: str


@router.get("/", summary="List users")
def list_users():
    """Return all users."""
    return []


@router.get("/{user_id}", response_model=User, summary="Get user")
def get_user(user_id: int):
    """Return a single user by id."""
    return {"id": user_id, "name": "Ada", "email": "ada@acme.dev"}


@router.post("/", response_model=User, status_code=201, summary="Create user")
def create_user(body: UserCreate):
    """Create a new user."""
    return {"id": 7, "name": body.name, "email": body.email}


@router.delete("/{user_id}", status_code=204, summary="Delete user")
def delete_user(user_id: int, user=Depends(get_current_user)):
    """Delete a user by id. Requires authentication."""
    return None
`,
};
