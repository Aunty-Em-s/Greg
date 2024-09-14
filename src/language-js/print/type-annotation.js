import { printComments } from "../../main/comments/print.js";
import {
  group,
  join,
  line,
  softline,
  indent,
  align,
  ifBreak,
} from "../../document/builders.js";
import pathNeedsParens from "../needs-parens.js";
import { hasSameLocStart } from "../loc.js";
import {
  isSimpleType,
  isObjectType,
  hasLeadingOwnLineComment,
  isObjectTypePropertyAFunction,
  hasComment,
  CommentCheckFlags,
} from "../utils/index.js";
import { printAssignment } from "./assignment.js";
import {
  printFunctionParameters,
  shouldGroupFunctionParameters,
} from "./function-parameters.js";
import {
  printOptionalToken,
  printDeclareToken,
  printAbstractToken,
} from "./misc.js";

/**
 * @typedef {import("../../document/builders.js").Doc} Doc
 */

function shouldHugType(node) {
  if (isSimpleType(node) || isObjectType(node)) {
    return true;
  }

  if (node.type === "UnionTypeAnnotation" || node.type === "TSUnionType") {
    const voidCount = node.types.filter(
      (node) =>
        node.type === "VoidTypeAnnotation" ||
        node.type === "TSVoidKeyword" ||
        node.type === "NullLiteralTypeAnnotation" ||
        node.type === "TSNullKeyword",
    ).length;

    const hasObject = node.types.some(
      (node) =>
        node.type === "ObjectTypeAnnotation" ||
        node.type === "TSTypeLiteral" ||
        // This is a bit aggressive but captures Array<{x}>
        node.type === "GenericTypeAnnotation" ||
        node.type === "TSTypeReference",
    );

    const hasComments = node.types.some((node) => hasComment(node));

    if (node.types.length - 1 === voidCount && hasObject && !hasComments) {
      return true;
    }
  }

  return false;
}

/*
- `DeclareOpaqueType`(flow)
- `OpaqueType`(flow)
*/
function printOpaqueType(path, options, print) {
  const semi = options.semi ? ";" : "";
  const { node } = path;
  const parts = [
    printDeclareToken(path),
    "opaque type ",
    print("id"),
    print("typeParameters"),
  ];

  if (node.supertype) {
    parts.push(": ", print("supertype"));
  }

  if (node.impltype) {
    parts.push(" = ", print("impltype"));
  }

  parts.push(semi);

  return parts;
}

/*
- `DeclareTypeAlias`(flow)
- `TypeAlias`(flow)
- `TSTypeAliasDeclaration`(TypeScript)
*/
function printTypeAlias(path, options, print) {
  const semi = options.semi ? ";" : "";
  const { node } = path;
  const parts = [printDeclareToken(path)];

  parts.push("type ", print("id"), print("typeParameters"));
  const rightPropertyName =
    node.type === "TSTypeAliasDeclaration" ? "typeAnnotation" : "right";
  return [
    printAssignment(path, options, print, parts, " =", rightPropertyName),
    semi,
  ];
}

// `TSIntersectionType` and `IntersectionTypeAnnotation`
function printIntersectionType(path, options, print) {
  let wasIndented = false;
  return group(
    path.map(({ isFirst, previous, node, index }) => {
      const doc = print();
      if (isFirst) {
        return doc;
      }

      const currentIsObjectType = isObjectType(node);
      const previousIsObjectType = isObjectType(previous);

      // If both are objects, don't indent
      if (previousIsObjectType && currentIsObjectType) {
        return [" & ", wasIndented ? indent(doc) : doc];
      }

      // If no object is involved, go to the next line if it breaks
      if (!previousIsObjectType && !currentIsObjectType) {
        return indent([" &", line, doc]);
      }

      // If you go from object to non-object or vis-versa, then inline it
      if (index > 1) {
        wasIndented = true;
      }

      return [" & ", index > 1 ? indent(doc) : doc];
    }, "types"),
  );
}

// `TSUnionType` and `UnionTypeAnnotation`
function printUnionType(path, options, print) {
  const { node } = path;
  // single-line variation
  // A | B | C

  // multi-line variation
  // | A
  // | B
  // | C

  const { parent } = path;

  // If there's a leading comment, the parent is doing the indentation
  const shouldIndent =
    parent.type !== "TypeParameterInstantiation" &&
    parent.type !== "TSTypeParameterInstantiation" &&
    parent.type !== "GenericTypeAnnotation" &&
    parent.type !== "TSTypeReference" &&
    parent.type !== "TSTypeAssertion" &&
    parent.type !== "TupleTypeAnnotation" &&
    parent.type !== "TSTupleType" &&
    !(
      parent.type === "FunctionTypeParam" &&
      !parent.name &&
      path.grandparent.this !== parent
    ) &&
    !(
      (parent.type === "TypeAlias" ||
        parent.type === "VariableDeclarator" ||
        parent.type === "TSTypeAliasDeclaration") &&
      hasLeadingOwnLineComment(options.originalText, node)
    );

  // {
  //   a: string
  // } | null | void
  // should be inlined and not be printed in the multi-line variant
  const shouldHug = shouldHugType(node);

  // We want to align the children but without its comment, so it looks like
  // | child1
  // // comment
  // | child2
  const printed = path.map((typePath) => {
    let printedType = print();
    if (!shouldHug) {
      printedType = align(2, printedType);
    }
    return printComments(typePath, printedType, options);
  }, "types");

  if (shouldHug) {
    return join(" | ", printed);
  }

  const shouldAddStartLine =
    shouldIndent && !hasLeadingOwnLineComment(options.originalText, node);

  const code = [
    ifBreak([shouldAddStartLine ? line : "", "| "]),
    join([line, "| "], printed),
  ];

  if (pathNeedsParens(path, options)) {
    return group([indent(code), softline]);
  }

  if (parent.type === "TupleTypeAnnotation" || parent.type === "TSTupleType") {
    const elementTypes =
      parent[
        // TODO: Remove `types` when babel changes AST of `TupleTypeAnnotation`
        parent.type === "TupleTypeAnnotation" && parent.types
          ? "types"
          : "elementTypes"
      ];

    if (elementTypes.length > 1) {
      return group([
        indent([ifBreak(["(", softline]), code]),
        softline,
        ifBreak(")"),
      ]);
    }
  }

  return group(shouldIndent ? indent(code) : code);
}

/*
`FunctionTypeAnnotation` is ambiguous:
- `declare function foo(a: B): void;`
- `var A: (a: B) => void;`
*/
function isFlowArrowFunctionTypeAnnotation(path) {
  const { node, parent } = path;
  return (
    node.type === "FunctionTypeAnnotation" &&
    (isObjectTypePropertyAFunction(parent) ||
      !(
        ((parent.type === "ObjectTypeProperty" ||
          parent.type === "ObjectTypeInternalSlot") &&
          !parent.variance &&
          !parent.optional &&
          hasSameLocStart(parent, node)) ||
        parent.type === "ObjectTypeCallProperty" ||
        path.getParentNode(2)?.type === "DeclareFunction"
      ))
  );
}

/*
- `TSFunctionType` (TypeScript)
- `TSCallSignatureDeclaration` (TypeScript)
- `TSConstructorType` (TypeScript)
- `TSConstructSignatureDeclaration` (TypeScript)
- `FunctionTypeAnnotation` (Flow)
*/
function printFunctionType(path, options, print) {
  const { node } = path;
  /** @type {Doc[]} */
  const parts = [
    // `TSConstructorType` only
    printAbstractToken(path),
  ];

  if (
    node.type === "TSConstructorType" ||
    node.type === "TSConstructSignatureDeclaration"
  ) {
    parts.push("new ");
  }

  let parametersDoc = printFunctionParameters(
    path,
    print,
    options,
    /* expandArg */ false,
    /* printTypeParams */ true,
  );

  const returnTypeDoc = [];
  // `flow` doesn't wrap the `returnType` with `TypeAnnotation`, so the colon
  // needs to be added separately.
  if (node.type === "FunctionTypeAnnotation") {
    returnTypeDoc.push(
      isFlowArrowFunctionTypeAnnotation(path) ? " => " : ": ",
      print("returnType"),
    );
  } else {
    returnTypeDoc.push(
      printTypeAnnotationProperty(
        path,
        print,
        node.returnType ? "returnType" : "typeAnnotation",
      ),
    );
  }

  if (shouldGroupFunctionParameters(node, returnTypeDoc)) {
    parametersDoc = group(parametersDoc);
  }

  parts.push(parametersDoc, returnTypeDoc);

  return group(parts);
}

/*
- `TSIndexedAccessType`(TypeScript)
- `IndexedAccessType`(flow)
- `OptionalIndexedAccessType`(flow)
*/
function printIndexedAccessType(path, options, print) {
  return [
    print("objectType"),
    printOptionalToken(path),
    "[",
    print("indexType"),
    "]",
  ];
}

/*
- `TSInferType`(TypeScript)
- `InferTypeAnnotation`(flow)
*/
function printInferType(path, options, print) {
  return ["infer ", print("typeParameter")];
}

// `TSJSDocNullableType`, `TSJSDocNonNullableType`
function printJSDocType(path, print, token) {
  const { node } = path;
  return [
    node.postfix ? "" : token,
    printTypeAnnotationProperty(path, print),
    node.postfix ? token : "",
  ];
}

/*
- `TSRestType`(TypeScript)
- `TupleTypeSpreadElement`(flow)
*/
function printRestType(path, options, print) {
  const { node } = path;

  return [
    "...",
    ...(node.type === "TupleTypeSpreadElement" && node.label
      ? [print("label"), ": "]
      : []),
    print("typeAnnotation"),
  ];
}

/*
- `TSNamedTupleMember`(TypeScript)
- `TupleTypeLabeledElement`(flow)
*/
function printNamedTupleMember(path, options, print) {
  const { node } = path;

  return [
    // `TupleTypeLabeledElement` only
    node.variance ? print("variance") : "",
    print("label"),
    node.optional ? "?" : "",
    ": ",
    print("elementType"),
  ];
}

/*
Normally the `(TS)TypeAnnotation` node starts with `:` token.
If we print `:` in parent node, `cursorNodeDiff` in `/src/main/core.js` will consider `:` is removed, cause cursor moves, see #12491.
Token *before* `(TS)TypeAnnotation.typeAnnotation` should be printed in `getTypeAnnotationFirstToken` function.
*/
const typeAnnotationNodesCheckedLeadingComments = new WeakSet();
function printTypeAnnotationProperty(
  path,
  print,
  propertyName = "typeAnnotation",
) {
  const {
    node: { [propertyName]: typeAnnotation },
  } = path;

  if (!typeAnnotation) {
    return "";
  }

  let shouldPrintLeadingSpace = false;

  if (
    typeAnnotation.type === "TSTypeAnnotation" ||
    typeAnnotation.type === "TypeAnnotation"
  ) {
    const firstToken = path.call(getTypeAnnotationFirstToken, propertyName);

    if (
      firstToken === "=>" ||
      (firstToken === ":" &&
        hasComment(typeAnnotation, CommentCheckFlags.Leading))
    ) {
      shouldPrintLeadingSpace = true;
    }

    typeAnnotationNodesCheckedLeadingComments.add(typeAnnotation);
  }

  return shouldPrintLeadingSpace
    ? [" ", print(propertyName)]
    : print(propertyName);
}

const getTypeAnnotationFirstToken = (path) => {
  if (
    // TypeScript
    path.match(
      (node) => node.type === "TSTypeAnnotation",
      (node, key) =>
        (key === "returnType" || key === "typeAnnotation") &&
        (node.type === "TSFunctionType" || node.type === "TSConstructorType"),
    )
  ) {
    return "=>";
  }

  if (
    // TypeScript
    path.match(
      (node) => node.type === "TSTypeAnnotation",
      (node, key) =>
        key === "typeAnnotation" &&
        (node.type === "TSJSDocNullableType" ||
          node.type === "TSJSDocNonNullableType" ||
          node.type === "TSTypePredicate"),
    ) ||
    /*
    Flow

    ```js
    declare function foo(): void;
                        ^^^^^^^^ `TypeAnnotation`
    ```
    */
    path.match(
      (node) => node.type === "TypeAnnotation",
      (node, key) => key === "typeAnnotation" && node.type === "Identifier",
      (node, key) => key === "id" && node.type === "DeclareFunction",
    ) ||
    /*
    Flow

    ```js
    type A = () => infer R extends string;
                                   ^^^^^^ `TypeAnnotation`
    ```
    */
    path.match(
      (node) => node.type === "TypeAnnotation",
      (node, key) =>
        key === "bound" &&
        node.type === "TypeParameter" &&
        node.usesExtendsBound,
    )
  ) {
    return "";
  }

  return ":";
};

/*
- `TSTypeAnnotation` (TypeScript)
- `TypeAnnotation` (Flow)
*/
function printTypeAnnotation(path, options, print) {
  // We need print space before leading comments,
  // `printTypeAnnotationProperty` is responsible for it.
  /* c8 ignore start */
  if (process.env.NODE_ENV !== "production") {
    const { node } = path;

    if (!typeAnnotationNodesCheckedLeadingComments.has(node)) {
      throw Object.assign(
        new Error(
          `'${node.type}' should be printed by '${printTypeAnnotationProperty.name}' function.`,
        ),
        { parentNode: path.parent, propertyName: path.key },
      );
    }
  }
  /* c8 ignore stop */

  const token = getTypeAnnotationFirstToken(path);
  return token
    ? [token, " ", print("typeAnnotation")]
    : print("typeAnnotation");
}

/*
- `TSArrayType`
- `ArrayTypeAnnotation`
*/
function printArrayType(print) {
  return [print("elementType"), "[]"];
}

/*
- `TSTypeQuery`
- `TypeofTypeAnnotation`
*/
function printTypeQuery({ node }, print) {
  return [
    "typeof ",
    ...(node.type === "TSTypeQuery"
      ? [print("exprName"), print("typeParameters")]
      : [print("argument")]),
  ];
}

function printTypePredicate(path, print) {
  const { node } = path;
  return [
    node.asserts ? "asserts " : "",
    print("parameterName"),
    node.typeAnnotation
      ? [" is ", printTypeAnnotationProperty(path, print)]
      : "",
  ];
}

export {
  printOpaqueType,
  printTypeAlias,
  printIntersectionType,
  printUnionType,
  printFunctionType,
  printIndexedAccessType,
  printInferType,
  shouldHugType,
  printJSDocType,
  printRestType,
  printNamedTupleMember,
  printTypeAnnotationProperty,
  printTypeAnnotation,
  printArrayType,
  printTypeQuery,
  printTypePredicate,
};
