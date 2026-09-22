import { describe, expect, it } from "vitest";
import { parseSpringFiles } from "@/lib/sentinel/parsers/spring";

const APP = new Map<string, string>([
  [
    "src/main/java/com/acme/UserController.java",
    `package com.acme;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public ResponseEntity<UserDto> getUser(@PathVariable Long id) {
        return ResponseEntity.ok(null);
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<UserDto> create(@RequestBody CreateUserDto body) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/search")
    public ResponseEntity<String> search(@RequestParam(value = "q", required = false) String q) {
        return ResponseEntity.ok("");
    }
}`,
  ],
  [
    "src/main/java/com/acme/dto.java",
    `package com.acme;
public class CreateUserDto {
    @NotBlank
    private String name;
    private String email;
}
public class UserDto {
    private Long id;
    private String name;
}`,
  ],
]);

describe("spring parser", () => {
  it("combines class-level and method-level mappings", () => {
    const { endpoints } = parseSpringFiles(APP);
    const ids = endpoints.map((e) => e.id).sort();
    expect(ids).toEqual([
      "GET /api/users/search",
      "GET /api/users/{id}",
      "POST /api/users",
    ]);
  });

  it("extracts path variables, request params, and DTO bodies", () => {
    const { endpoints } = parseSpringFiles(APP);
    const get = endpoints.find((e) => e.id === "GET /api/users/{id}")!;
    expect(get.pathParams[0]).toMatchObject({ name: "id", in: "path", required: true });
    const search = endpoints.find((e) => e.id === "GET /api/users/search")!;
    expect(search.queryParams[0]).toMatchObject({ name: "q", required: false });
    const post = endpoints.find((e) => e.id === "POST /api/users")!;
    expect(post.requestBody?.fields).toContainEqual(
      expect.objectContaining({ name: "name", required: true })
    );
  });

  it("detects security annotations", () => {
    const { endpoints } = parseSpringFiles(APP);
    const post = endpoints.find((e) => e.id === "POST /api/users")!;
    expect(post.auth.required).toBe(true);
    expect(post.auth.confidence).toBe("detected");
  });

  it("resolves ResponseEntity DTO fields", () => {
    const { endpoints } = parseSpringFiles(APP);
    const get = endpoints.find((e) => e.id === "GET /api/users/{id}")!;
    expect(get.responses[0].fields.map((f) => f.name).sort()).toEqual(["id", "name"]);
  });
});
