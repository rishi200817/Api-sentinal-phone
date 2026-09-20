/**
 * Spring Boot / Java route extractor.
 * Supports @RestController, class/method mappings, @PathVariable,
 * @RequestParam, @RequestBody DTOs, ResponseEntity, and common
 * security annotations. Advanced unsupported constructs are marked
 * explicitly instead of producing wrong routes.
 */
import type {
  ApiParam,
  EndpointContract,
  ResponseShape,
  SchemaField,
} from "../types";
import {
  endpointId,
  joinPaths,
  lineOf,
  mapJavaType,
  normalizePath,
  readBalanced,
  splitTopLevelArgs,
} from "./util";

export interface DtoModel {
  name: string;
  file: string;
  fields: SchemaField[];
}

const METHOD_MAP: Record<string, string> = {
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  PatchMapping: "PATCH",
  DeleteMapping: "DELETE",
};

function firstPathFromArgs(args: string): string | null {
  // value="/x", path="/x", "/x", value={"/a","/b"} (take first, note multi)
  const m =
    args.match(/(?:value|path)\s*=\s*\{?\s*"([^"]+)"/) ??
    args.match(/^\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function hasMultiPath(args: string): boolean {
  return /\{[^}]*"[^"]*"[^}]*,[^}]*\}/.test(args);
}

export function parseDtos(file: string, text: string): DtoModel[] {
  const out: DtoModel[] = [];
  // record-style DTOs
  const recordRe = /record\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = recordRe.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    const fields: SchemaField[] = [];
    if (bal) {
      for (const part of splitTopLevelArgs(bal.inner)) {
        const fm = part.trim().match(/(?:@\w+(?:\([^)]*\))?\s*)*([\w<>\[\]., ]+?)\s+(\w+)$/);
        if (fm) {
          fields.push({
            name: fm[2],
            type: mapJavaType(fm[1]),
            required: true,
            origin: `record ${m[1]}`,
            confidence: "detected",
          });
        }
      }
    }
    out.push({ name: m[1], file, fields });
  }
  // class-style DTOs: private Type name;
  const classRe = /(?:public\s+|protected\s+|private\s+)?class\s+(\w+)/g;
  while ((m = classRe.exec(text))) {
    const name = m[1];
    const braceIdx = text.indexOf("{", m.index);
    if (braceIdx < 0) continue;
    const bal = readBalanced(text, braceIdx, "{", "}");
    if (!bal) continue;
    const fields: SchemaField[] = [];
    const seen = new Set<string>();
    // walk field declarations with preceding annotations
    const fieldRe =
      /((?:@\w+(?:\([^)]*\))?\s*)*)(?:private|protected|public)\s+([\w<>\[\]., ?]+?)\s+(\w+)\s*(?:=|;)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(bal.inner))) {
      const annos = fm[1] ?? "";
      if (/static|final\s+.*=/.test(fm[0]) && /static/.test(fm[0])) continue;
      const type = fm[2].trim();
      const fname = fm[3];
      if (seen.has(fname)) continue;
      seen.add(fname);
      const required = /NotNull|NotBlank|NotEmpty/.test(annos);
      fields.push({
        name: fname,
        type: mapJavaType(type),
        required,
        origin: `DTO ${name}`,
        confidence: "detected",
      });
    }
    if (fields.length) {
      // merge with record entry of same name if present
      const existing = out.find((d) => d.name === name);
      if (existing) {
        for (const f of fields) {
          if (!existing.fields.some((e) => e.name === f.name)) existing.fields.push(f);
        }
      } else {
        out.push({ name, file, fields });
      }
    }
  }
  return out;
}

export interface ControllerMethod {
  method: string;
  path: string;
  multiPath: boolean;
  line: number;
  annotations: string;
  returnType: string;
  params: string;
  methodName: string;
  responseStatus: string | null;
}

export function parseControllers(
  file: string,
  text: string
): { basePath: string; methods: ControllerMethod[]; isController: boolean }[] {
  const out: { basePath: string; methods: ControllerMethod[]; isController: boolean }[] = [];
  const lines = text.split("\n");
  // find classes with @RestController/@Controller
  const classRe = /@\s*(RestController|Controller)\b[\s\S]{0,600}?(?:public\s+)?(?:class|record)\s+(\w+)/g;
  let cm: RegExpExecArray | null;
  const guarded: [number, number][] = [];
  while ((cm = classRe.exec(text))) {
    const braceIdx = text.indexOf("{", cm.index);
    if (braceIdx < 0) continue;
    const bal = readBalanced(text, braceIdx, "{", "}");
    if (!bal) continue;
    guarded.push([braceIdx, bal.end]);
    const header = text.slice(cm.index, braceIdx);
    const baseReq = header.match(/@RequestMapping\s*\(/);
    let basePath = "";
    if (baseReq && baseReq.index !== undefined) {
      const absIdx = cm.index + baseReq.index + baseReq[0].length - 1;
      const bb = readBalanced(text, absIdx);
      if (bb) basePath = firstPathFromArgs(bb.inner) ?? "";
    }
    const body = bal.inner;
    const methods: ControllerMethod[] = [];
    const mapRe =
      /@\s*(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*(\([^)]*\))?/g;
    let mm: RegExpExecArray | null;
    while ((mm = mapRe.exec(body))) {
      const anno = mm[1];
      let httpMethod = METHOD_MAP[anno];
      let path = "";
      let multiPath = false;
      if (mm[2]) {
        const inner = mm[2].slice(1, -1);
        multiPath = hasMultiPath(inner);
        path = firstPathFromArgs(inner) ?? "";
        if (anno === "RequestMapping") {
          const methodM = inner.match(/method\s*=\s*RequestMethod\.(\w+)/);
          httpMethod = methodM ? methodM[1] : "GET";
        }
      } else if (anno === "RequestMapping") {
        continue; // class-level style inside body; skip
      }
      // method signature after annotations: skip @Name(...) blocks with
      // balanced-paren reading (annotation args may contain parens/strings)
      let cursor = mm.index + mm[0].length;
      let guard = 0;
      while (guard++ < 25) {
        const mAnno = /^\s*@\w+/.exec(body.slice(cursor));
        if (!mAnno) break;
        cursor += mAnno[0].length;
        if (body[cursor] === "(") {
          const bal = readBalanced(body, cursor);
          if (!bal) break;
          cursor = bal.end;
        }
      }
      const sigM = /^\s*(?:public|protected|private)?\s*([\w<>\[\]., ?]+?)\s+(\w+)\s*\(/.exec(
        body.slice(cursor)
      );
      if (!sigM) continue;
      const absParen = braceIdx + 1 + cursor + sigM[0].lastIndexOf("(");
      const sigBal = readBalanced(text, absParen);
      const params = sigBal ? sigBal.inner : "";
      const annoBlock = body.slice(mm.index + mm[0].length, cursor + sigM[0].length);
      const statusM = annoBlock.match(/@ResponseStatus\s*\(\s*(?:value\s*=\s*)?(?:HttpStatus\.)?(\w+|\d+)/);
      let responseStatus: string | null = null;
      if (statusM) {
        const codeMap: Record<string, string> = {
          OK: "200",
          CREATED: "201",
          ACCEPTED: "202",
          NO_CONTENT: "204",
        };
        responseStatus = /^\d+$/.test(statusM[1])
          ? statusM[1]
          : (codeMap[statusM[1]] ?? null);
      }
      methods.push({
        method: httpMethod ?? "GET",
        path,
        multiPath,
        line: lineOf(text, braceIdx + 1 + mm.index),
        annotations: annoBlock.slice(0, 800),
        returnType: sigM[1].trim(),
        params,
        methodName: sigM[2],
        responseStatus,
      });
    }
    out.push({ basePath, methods, isController: true });
  }
  void lines;
  void guarded;
  return out;
}

export function parseMethodParams(
  params: string,
  dtos: Map<string, DtoModel>
): {
  pathParams: ApiParam[];
  queryParams: ApiParam[];
  bodyDto: string | null;
  bodyFields: SchemaField[];
  authVia: string[];
  headerParams: ApiParam[];
} {
  const pathParams: ApiParam[] = [];
  const queryParams: ApiParam[] = [];
  const headerParams: ApiParam[] = [];
  let bodyDto: string | null = null;
  let bodyFields: SchemaField[] = [];
  const authVia: string[] = [];

  for (const raw of splitTopLevelArgs(params)) {
    const p = raw.trim();
    if (!p) continue;
    // @PathVariable("id") String id | @PathVariable String id
    let pm = p.match(
      /@PathVariable(?:\s*\(\s*(?:value\s*=\s*)?"([^"]+)"[^)]*\))?\s+([\w<>\[\]]+)\s+(\w+)\s*$/
    );
    if (pm) {
      pathParams.push({
        name: pm[1] ?? pm[3],
        in: "path",
        required: true,
        type: mapJavaType(pm[2]),
        origin: "@PathVariable",
        confidence: "detected",
      });
      continue;
    }
    // @RequestParam(value="q", required=false, defaultValue="x") String q
    pm = p.match(/@RequestParam\s*(\([^)]*\))?\s+([\w<>\[\]]+)\s+(\w+)\s*$/);
    if (pm) {
      const annoArgs = pm[1] ?? "";
      const nameM = annoArgs.match(/(?:value|name)\s*=\s*"([^"]+)"/);
      const requiredM = annoArgs.match(/required\s*=\s*(true|false)/);
      const required = requiredM ? requiredM[1] === "true" : true;
      queryParams.push({
        name: nameM?.[1] ?? pm[3],
        in: "query",
        required: /defaultValue/.test(annoArgs) ? false : required,
        type: mapJavaType(pm[2]),
        origin: "@RequestParam",
        confidence: "detected",
      });
      continue;
    }
    // @RequestHeader
    pm = p.match(/@RequestHeader\s*(\([^)]*\))?\s+([\w<>\[\]]+)\s+(\w+)\s*$/);
    if (pm) {
      const annoArgs = pm[1] ?? "";
      const nameM = annoArgs.match(/(?:value|name)\s*=\s*"([^"]+)"/);
      headerParams.push({
        name: nameM?.[1] ?? pm[3],
        in: "header",
        required: !/required\s*=\s*false/.test(annoArgs),
        type: "string",
        origin: "@RequestHeader",
        confidence: "detected",
      });
      continue;
    }
    // @RequestBody FooDto dto
    pm = p.match(/@RequestBody(?:\s*\([^)]*\))?\s+([\w<>\[\].]+)\s+(\w+)\s*$/);
    if (pm) {
      const dtoName = pm[1].split(".").pop()!.replace(/<.*>/, "");
      bodyDto = dtoName;
      const dto = dtos.get(dtoName);
      bodyFields = dto ? dto.fields : [];
      continue;
    }
    // bare scalar param on GET -> likely @RequestParam without annotation
    pm = p.match(/^([\w<>\[\]]+)\s+(\w+)$/);
    if (pm && /^(String|int|Integer|long|Long|boolean|Boolean|double|Double)$/.test(pm[1])) {
      queryParams.push({
        name: pm[2],
        in: "query",
        required: false,
        type: mapJavaType(pm[1]),
        origin: "bare method param (implicit request param)",
        confidence: "inferred",
      });
      continue;
    }
    // Principal / Authentication -> auth evidence
    if (/\b(Principal|Authentication|Jwt|OidcUser)\b/.test(p)) {
      authVia.push(p.slice(0, 80));
    }
  }
  return { pathParams, queryParams, bodyDto, bodyFields, authVia, headerParams };
}

export interface SpringFileModel {
  file: string;
  dtos: DtoModel[];
  controllers: { basePath: string; methods: ControllerMethod[]; isController: boolean }[];
}

export function buildSpringFileModel(file: string, text: string): SpringFileModel {
  return { file, dtos: parseDtos(file, text), controllers: parseControllers(file, text) };
}

export function parseSpringFiles(files: Map<string, string>): {
  endpoints: EndpointContract[];
} {
  const javaFiles = [...files.entries()].filter(([f]) => f.endsWith(".java"));
  const perFile = new Map<string, SpringFileModel>();
  for (const [file, text] of javaFiles) {
    perFile.set(file, buildSpringFileModel(file, text));
  }
  return { endpoints: assembleSpringEndpoints(perFile) };
}

/** Assemble endpoints from merged per-file models (cheap; rerun after incremental merge). */
export function assembleSpringEndpoints(
  perFile: Map<string, SpringFileModel>
): EndpointContract[] {
  const dtos = new Map<string, DtoModel>();
  for (const [, fm] of perFile) {
    for (const d of fm.dtos) {
      if (!dtos.has(d.name)) dtos.set(d.name, d);
    }
  }
  const endpoints: EndpointContract[] = [];
  for (const [file, fm] of perFile) {
    const controllers = fm.controllers;
    for (const c of controllers) {
      for (const m of c.methods) {
        const fullPath = normalizePath(joinPaths(c.basePath, m.path || "/"));
        const parsed = parseMethodParams(m.params, dtos);
        // infer path vars present in template but missing annotation
        const templateVars = new Set(
          [...fullPath.matchAll(/\{(\w+)\}/g)].map((x) => x[1])
        );
        for (const v of templateVars) {
          if (!parsed.pathParams.some((p) => p.name === v)) {
            parsed.pathParams.push({
              name: v,
              in: "path",
              required: true,
              type: "string",
              origin: "path template (annotation not found)",
              confidence: "inferred",
            });
          }
        }
        // auth: annotations + principal params
        const securedBy = [
          ...m.annotations.matchAll(/@(PreAuthorize|Secured|RolesAllowed)\s*(\([^)]*\))?/g),
        ].map((x) => `@${x[1]}`);
        const authRequired = securedBy.length > 0 || parsed.authVia.length > 0;

        // return type -> response
        const responses: ResponseShape[] = [];
        const status = m.responseStatus ?? (m.method === "POST" ? "201" : "200");
        const retM = m.returnType.match(/ResponseEntity<\s*([\w.]+)\s*>/);
        const retDto = retM ? retM[1].split(".").pop()! : null;
        const respFields =
          retDto && dtos.has(retDto) ? dtos.get(retDto)!.fields : [];
        const unsupportedReturn =
          /Flux|Mono|StreamingResponseBody|Callable|DeferredResult|SseEmitter/.test(
            m.returnType
          );
        responses.push({
          status,
          description: unsupportedReturn
            ? `Reactive/streaming return (${m.returnType}) — body shape not modeled`
            : "Success",
          fields: respFields,
          origin: retDto
            ? dtos.has(retDto)
              ? `ResponseEntity<${retDto}>`
              : `ResponseEntity<${retDto}> (DTO not found)`
            : "status default",
          confidence: retDto && dtos.has(retDto) ? "detected" : "inferred",
        });

        const notes: string[] = [];
        if (m.multiPath)
          notes.push("Multiple mapping paths declared; first path modeled, others ignored.");
        if (unsupportedReturn)
          notes.push(`Return type ${m.returnType} is not structurally modeled.`);
        if (parsed.bodyDto && !dtos.has(parsed.bodyDto))
          notes.push(`@RequestBody DTO ${parsed.bodyDto} not found in scanned sources.`);

        endpoints.push({
          id: endpointId(m.method, fullPath),
          method: m.method as EndpointContract["method"],
          path: fullPath,
          controller: file.split("/").pop(),
          sourceFile: file,
          sourceLine: m.line,
          framework: "spring",
          pathParams: parsed.pathParams,
          queryParams: parsed.queryParams,
          requestBody:
            parsed.bodyFields.length > 0 || parsed.bodyDto
              ? {
                  contentType: "application/json",
                  fields: parsed.bodyFields,
                  present: true,
                  origin: parsed.bodyDto ? `@RequestBody ${parsed.bodyDto}` : "@RequestBody",
                  confidence: parsed.bodyDto && dtos.has(parsed.bodyDto) ? "detected" : "inferred",
                }
              : undefined,
          responses,
          auth: authRequired
            ? {
                required: true,
                schemes: securedBy.length ? securedBy : ["Principal/Authentication param"],
                description:
                  securedBy.length > 0
                    ? `Secured by ${securedBy.join(", ")}`
                    : "Method takes security principal",
                origin: "security annotation/principal",
                confidence: "detected",
              }
            : {
                required: false,
                schemes: [],
                description: "No security annotation observed",
                origin: "annotation scan",
                confidence: "inferred",
              },
          summary: `${m.method} ${fullPath}`,
          description: notes.length ? notes.join(" ") : undefined,
          confidence: "detected",
        });
      }
    }
  }
  return endpoints;
}
