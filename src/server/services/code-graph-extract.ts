// Pure extraction: parse one source file with web-tree-sitter and walk the AST
// once, producing symbols (declarations) and unresolved edges (imports by module
// specifier, calls by callee name). Edge *resolution* (specifier → target file
// node, callee name → symbol node) happens later in the indexer, where the whole
// project's node index is available. Kept free of DB/IO so it's unit-testable
// over fixture files.

import type { Node } from "web-tree-sitter";
import type { GraphLanguage, GraphNodeKind } from "~/shared/code-graph";
import { getGraphParser } from "./code-graph-wasm";

/** A declaration found in a file, before it's assigned a DB id. */
export interface ExtractedSymbol {
  /** File-local index; `calls` reference their enclosing symbol by this. */
  index: number;
  kind: GraphNodeKind;
  name: string;
  startLine: number; // 1-based
  endLine: number; // 1-based
  exported: boolean;
  signature: string | null;
}

/** An import/require/re-export: a module specifier to resolve to a file node. */
export interface ExtractedImport {
  spec: string;
}

/** A call site: the callee name plus the symbol that contains it (or null = file scope). */
export interface ExtractedCall {
  calleeName: string;
  enclosingIndex: number | null;
  /** `x.foo()` (method/property call) vs a bare `foo()` identifier call. */
  isMember: boolean;
}

export interface FileExtraction {
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
  calls: ExtractedCall[];
  /** True when tree-sitter flagged a syntax error (kept for diagnostics). */
  hadError: boolean;
}

function firstNamedChildOfType(node: Node, type: string): Node | null {
  for (const child of node.namedChildren) {
    if (child && child.type === type) return child;
  }
  return null;
}

/** Text of a function/method's params + return type, e.g. `(a: number): void`. */
function signatureOf(node: Node): string | null {
  const params = node.childForFieldName("parameters") ?? firstNamedChildOfType(node, "formal_parameters");
  if (!params) return null;
  const ret =
    node.childForFieldName("return_type") ?? firstNamedChildOfType(node, "type_annotation");
  const paramsText = params.text.replace(/\s+/g, " ").trim();
  const retText = ret ? ret.text.replace(/\s+/g, " ").trim() : "";
  const sig = retText ? `${paramsText}${retText.startsWith(":") ? "" : ": "}${retText}` : paramsText;
  return sig.slice(0, 400);
}

function nameText(node: Node | null): string | null {
  if (!node) return null;
  const t = node.text.trim();
  return t.length ? t : null;
}

/** The module specifier of an import/re-export `string` node, unquoted. */
function stringLiteralValue(node: Node | null): string | null {
  if (!node) return null;
  const frag = firstNamedChildOfType(node, "string_fragment");
  if (frag) return frag.text;
  // Fallback: strip surrounding quotes.
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

const REQUIRE_LIKE = new Set(["require"]);

/**
 * Walk the tree once. `enclosing` is the index of the nearest containing symbol
 * (for attributing call sites); declarations push themselves as the enclosing
 * symbol for their own subtree.
 */
export function extractFromTree(rootNode: Node, _language: GraphLanguage): FileExtraction {
  const symbols: ExtractedSymbol[] = [];
  const imports: ExtractedImport[] = [];
  const calls: ExtractedCall[] = [];

  const pushSymbol = (
    kind: GraphNodeKind,
    name: string,
    node: Node,
    exported: boolean,
    signature: string | null,
  ): number => {
    const index = symbols.length;
    symbols.push({
      index,
      kind,
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported,
      signature,
    });
    return index;
  };

  const isExported = (declNode: Node): boolean => {
    const parent = declNode.parent;
    if (!parent) return false;
    if (parent.type === "export_statement") return true;
    // variable_declarator → lexical_declaration/variable_declaration → export_statement
    if (parent.type === "lexical_declaration" || parent.type === "variable_declaration") {
      return parent.parent?.type === "export_statement";
    }
    return false;
  };

  const walk = (node: Node, enclosing: number | null): void => {
    let nextEnclosing = enclosing;
    switch (node.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const name = nameText(node.childForFieldName("name"));
        if (name) {
          nextEnclosing = pushSymbol("function", name, node, isExported(node), signatureOf(node));
        }
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration": {
        const name = nameText(node.childForFieldName("name"));
        if (name) nextEnclosing = pushSymbol("class", name, node, isExported(node), null);
        break;
      }
      case "interface_declaration": {
        const name = nameText(node.childForFieldName("name"));
        if (name) pushSymbol("interface", name, node, isExported(node), null);
        break;
      }
      case "type_alias_declaration": {
        const name = nameText(node.childForFieldName("name"));
        if (name) pushSymbol("type", name, node, isExported(node), null);
        break;
      }
      case "method_definition": {
        const name = nameText(node.childForFieldName("name"));
        // Methods count as exported iff their class is exported.
        if (name) nextEnclosing = pushSymbol("method", name, node, false, signatureOf(node));
        break;
      }
      case "variable_declarator": {
        const name = nameText(node.childForFieldName("name"));
        const value = node.childForFieldName("value");
        if (name && value && (value.type === "arrow_function" || value.type === "function_expression")) {
          nextEnclosing = pushSymbol("function", name, node, isExported(node), signatureOf(value));
        } else if (name && isExported(node)) {
          // Only surface exported top-level values as `variable` nodes (keeps noise down).
          const parent = node.parent;
          const topLevel = parent?.parent?.type === "export_statement" || parent?.parent?.type === "program";
          if (topLevel) pushSymbol("variable", name, node, true, null);
        }
        break;
      }
      case "import_statement": {
        const spec = stringLiteralValue(node.childForFieldName("source"));
        if (spec) imports.push({ spec });
        break;
      }
      case "export_statement": {
        // Re-export: `export { x } from "./mod"` / `export * from "./mod"`.
        const spec = stringLiteralValue(node.childForFieldName("source"));
        if (spec) imports.push({ spec });
        break;
      }
      case "call_expression": {
        const fn = node.childForFieldName("function");
        if (fn) {
          // Dynamic `import("x")` — the callee is an `import` keyword node, not
          // an identifier. `require("x")` is a plain identifier call.
          const isDynamicImport = fn.type === "import";
          if (isDynamicImport || (fn.type === "identifier" && REQUIRE_LIKE.has(fn.text))) {
            const args = node.childForFieldName("arguments");
            const argStr = args ? firstNamedChildOfType(args, "string") : null;
            const spec = stringLiteralValue(argStr);
            if (spec) imports.push({ spec });
          } else if (fn.type === "identifier") {
            calls.push({ calleeName: fn.text, enclosingIndex: enclosing, isMember: false });
          } else if (fn.type === "member_expression") {
            const prop = nameText(fn.childForFieldName("property"));
            if (prop) calls.push({ calleeName: prop, enclosingIndex: enclosing, isMember: true });
          }
        }
        break;
      }
    }
    for (const child of node.namedChildren) {
      if (child) walk(child, nextEnclosing);
    }
  };

  walk(rootNode, null);
  return { symbols, imports, calls, hadError: rootNode.hasError };
}

/** Parse `source` for `language` and extract. Returns null on a parse failure. */
export async function extractFile(
  source: string,
  language: GraphLanguage,
): Promise<FileExtraction> {
  const parser = await getGraphParser(language);
  try {
    const tree = parser.parse(source);
    if (!tree) return { symbols: [], imports: [], calls: [], hadError: true };
    try {
      return extractFromTree(tree.rootNode, language);
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}
