import isEs5IdentifierName from "@prettier/is-es5-identifier-name";
import { hasDescendant } from "../../utils/ast-utils.js";
import hasNewline from "../../utils/has-newline.js";
import isNonEmptyArray from "../../utils/is-non-empty-array.js";
import isNextLineEmptyAfterIndex from "../../utils/is-next-line-empty.js";
import getStringWidth from "../../utils/get-string-width.js";
import { locStart, locEnd, hasSameLocStart } from "../loc.js";
import getVisitorKeys from "../traverse/get-visitor-keys.js";
import createTypeCheckFunction from "./create-type-check-function.js";
import isBlockComment from "./is-block-comment.js";
import isNodeMatches from "./is-node-matches.js";
import isFlowKeywordType from "./is-flow-keyword-type.js";
import isTsKeywordType from "./is-ts-keyword-type.js";

/**
 * @typedef {import("../types/estree.js").Node} Node
 * @typedef {import("../types/estree.js").TemplateLiteral} TemplateLiteral
 * @typedef {import("../types/estree.js").Comment} Comment
 * @typedef {import("../types/estree.js").MemberExpression} MemberExpression
 * @typedef {import("../types/estree.js").OptionalMemberExpression} OptionalMemberExpression
 * @typedef {import("../types/estree.js").CallExpression} CallExpression
 * @typedef {import("../types/estree.js").OptionalCallExpression} OptionalCallExpression
 * @typedef {import("../types/estree.js").Expression} Expression
 * @typedef {import("../types/estree.js").Property} Property
 * @typedef {import("../types/estree.js").ObjectTypeProperty} ObjectTypeProperty
 * @typedef {import("../types/estree.js").TaggedTemplateExpression} TaggedTemplateExpression
 * @typedef {import("../types/estree.js").Literal} Literal
 *
 * @typedef {import("../../common/ast-path.js").default} AstPath
 */

/**
 * @param {Node} node
 * @param {(Node) => boolean} predicate
 * @returns {boolean}
 */
function hasNode(node, predicate) {
  return predicate(node) || hasDescendant(node, { getVisitorKeys, predicate });
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function hasNakedLeftSide(node) {
  return (
    node.type === "AssignmentExpression" ||
    node.type === "BinaryExpression" ||
    node.type === "LogicalExpression" ||
    node.type === "NGPipeExpression" ||
    node.type === "ConditionalExpression" ||
    isCallExpression(node) ||
    isMemberExpression(node) ||
    node.type === "SequenceExpression" ||
    node.type === "TaggedTemplateExpression" ||
    node.type === "BindExpression" ||
    (node.type === "UpdateExpression" && !node.prefix) ||
    isTSTypeExpression(node) ||
    node.type === "TSNonNullExpression" ||
    node.type === "ChainExpression"
  );
}

function getLeftSide(node) {
  if (node.expressions) {
    return node.expressions[0];
  }
  return (
    node.left ??
    node.test ??
    node.callee ??
    node.object ??
    node.tag ??
    node.argument ??
    node.expression
  );
}

function getLeftSidePathName(node) {
  if (node.expressions) {
    return ["expressions", 0];
  }
  if (node.left) {
    return ["left"];
  }
  if (node.test) {
    return ["test"];
  }
  if (node.object) {
    return ["object"];
  }
  if (node.callee) {
    return ["callee"];
  }
  if (node.tag) {
    return ["tag"];
  }
  if (node.argument) {
    return ["argument"];
  }
  if (node.expression) {
    return ["expression"];
  }
  throw new Error("Unexpected node has no left side.");
}

/**
 * @param {Comment} comment
 * @returns {boolean}
 */
const isLineComment = createTypeCheckFunction([
  "Line",
  "CommentLine",
  // `meriyah` has `SingleLine`, `HashbangComment`, `HTMLOpen`, and `HTMLClose`
  "SingleLine",
  "HashbangComment",
  "HTMLOpen",
  "HTMLClose",
  // `espree`
  "Hashbang",
  // Babel hashbang
  "InterpreterDirective",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isExportDeclaration = createTypeCheckFunction([
  "ExportDefaultDeclaration",
  "DeclareExportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "DeclareExportAllDeclaration",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isArrayOrTupleExpression = createTypeCheckFunction([
  "ArrayExpression",
  "TupleExpression",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isObjectOrRecordExpression = createTypeCheckFunction([
  "ObjectExpression",
  "RecordExpression",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isNumericLiteral(node) {
  return (
    node.type === "NumericLiteral" ||
    (node.type === "Literal" && typeof node.value === "number")
  );
}

function isSignedNumericLiteral(node) {
  return (
    node.type === "UnaryExpression" &&
    (node.operator === "+" || node.operator === "-") &&
    isNumericLiteral(node.argument)
  );
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isStringLiteral(node) {
  return (
    node.type === "StringLiteral" ||
    (node.type === "Literal" && typeof node.value === "string")
  );
}

function isRegExpLiteral(node) {
  return (
    node.type === "RegExpLiteral" ||
    (node.type === "Literal" && Boolean(node.regex))
  );
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isObjectType = createTypeCheckFunction([
  "ObjectTypeAnnotation",
  "TSTypeLiteral",
  "TSMappedType",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isFunctionOrArrowExpression = createTypeCheckFunction([
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isFunctionOrArrowExpressionWithBody(node) {
  return (
    node.type === "FunctionExpression" ||
    (node.type === "ArrowFunctionExpression" &&
      node.body.type === "BlockStatement")
  );
}

/**
 * Note: `inject` is used in AngularJS 1.x, `async` and `fakeAsync` in
 * Angular 2+, although `async` is deprecated and replaced by `waitForAsync`
 * since Angular 12.
 *
 * example: https://docs.angularjs.org/guide/unit-testing#using-beforeall-
 *
 * @param {CallExpression} node
 * @returns {boolean}
 */
function isAngularTestWrapper(node) {
  return (
    isCallExpression(node) &&
    node.callee.type === "Identifier" &&
    ["async", "inject", "fakeAsync", "waitForAsync"].includes(node.callee.name)
  );
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isJsxElement = createTypeCheckFunction(["JSXElement", "JSXFragment"]);

function isGetterOrSetter(node) {
  return node.kind === "get" || node.kind === "set";
}

// TODO: This is a bad hack and we need a better way to distinguish between
// arrow functions and otherwise
function isFunctionNotation(node) {
  return isGetterOrSetter(node) || hasSameLocStart(node, node.value);
}

// Hack to differentiate between the following two which have the same ast
// type T = { method: () => void };
// type T = { method(): void };
/**
 * @param {Node} node
 * @returns {boolean}
 */
function isObjectTypePropertyAFunction(node) {
  return (
    (node.type === "ObjectTypeProperty" ||
      node.type === "ObjectTypeInternalSlot") &&
    node.value.type === "FunctionTypeAnnotation" &&
    !node.static &&
    !isFunctionNotation(node)
  );
}

// Hack to differentiate between the following two which have the same ast
// declare function f(a): void;
// var f: (a) => void;
function isTypeAnnotationAFunction(node) {
  return (
    (node.type === "TypeAnnotation" || node.type === "TSTypeAnnotation") &&
    node.typeAnnotation.type === "FunctionTypeAnnotation" &&
    !node.static &&
    !hasSameLocStart(node, node.typeAnnotation)
  );
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isBinaryish = createTypeCheckFunction([
  "BinaryExpression",
  "LogicalExpression",
  "NGPipeExpression",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isMemberish(node) {
  return (
    isMemberExpression(node) ||
    (node.type === "BindExpression" && Boolean(node.object))
  );
}

const isSimpleTypeAnnotation = createTypeCheckFunction([
  "TSThisType",
  // literals
  "NullLiteralTypeAnnotation",
  "BooleanLiteralTypeAnnotation",
  "StringLiteralTypeAnnotation",
  "BigIntLiteralTypeAnnotation",
  "NumberLiteralTypeAnnotation",
  "TSLiteralType",
  "TSTemplateLiteralType",
]);
/**
 * @param {Node} node
 * @returns {boolean}
 */
function isSimpleType(node) {
  return (
    isTsKeywordType(node) ||
    isFlowKeywordType(node) ||
    isSimpleTypeAnnotation(node) ||
    ((node.type === "GenericTypeAnnotation" ||
      node.type === "TSTypeReference") &&
      !node.typeParameters)
  );
}

/**
 * @param {CallExpression} node
 * @returns {boolean}
 */
function isUnitTestSetUp(node) {
  const unitTestSetUpRe = /^(?:before|after)(?:Each|All)$/;
  return (
    node.callee.type === "Identifier" &&
    node.arguments.length === 1 &&
    unitTestSetUpRe.test(node.callee.name)
  );
}

const testCallCalleePatterns = [
  "it",
  "it.only",
  "it.skip",
  "describe",
  "describe.only",
  "describe.skip",
  "test",
  "test.only",
  "test.skip",
  "test.step",
  "test.describe",
  "test.describe.only",
  "test.describe.parallel",
  "test.describe.parallel.only",
  "test.describe.serial",
  "test.describe.serial.only",
  "skip",
  "xit",
  "xdescribe",
  "xtest",
  "fit",
  "fdescribe",
  "ftest",
];

function isTestCallCallee(node) {
  return isNodeMatches(node, testCallCalleePatterns);
}

// eg; `describe("some string", (done) => {})`
function isTestCall(node, parent) {
  if (node.type !== "CallExpression") {
    return false;
  }
  if (node.arguments.length === 1) {
    if (isAngularTestWrapper(node) && parent && isTestCall(parent)) {
      return isFunctionOrArrowExpression(node.arguments[0]);
    }

    if (isUnitTestSetUp(node)) {
      return isAngularTestWrapper(node.arguments[0]);
    }
  } else if (
    (node.arguments.length === 2 || node.arguments.length === 3) &&
    (node.arguments[0].type === "TemplateLiteral" ||
      isStringLiteral(node.arguments[0])) &&
    isTestCallCallee(node.callee)
  ) {
    // it("name", () => { ... }, 2500)
    if (node.arguments[2] && !isNumericLiteral(node.arguments[2])) {
      return false;
    }
    return (
      (node.arguments.length === 2
        ? isFunctionOrArrowExpression(node.arguments[1])
        : isFunctionOrArrowExpressionWithBody(node.arguments[1]) &&
          getFunctionParameters(node.arguments[1]).length <= 1) ||
      isAngularTestWrapper(node.arguments[1])
    );
  }
  return false;
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isCallExpression = createTypeCheckFunction([
  "CallExpression",
  "OptionalCallExpression",
]);

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isMemberExpression = createTypeCheckFunction([
  "MemberExpression",
  "OptionalMemberExpression",
]);

/**
 *
 * @param {any} node
 * @returns {boolean}
 */
function isSimpleTemplateLiteral(node) {
  let expressionsKey = "expressions";
  if (node.type === "TSTemplateLiteralType") {
    expressionsKey = "types";
  }
  const expressions = node[expressionsKey];

  if (expressions.length === 0) {
    return false;
  }

  return expressions.every((expr) => {
    // Disallow comments since printDocToString can't print them here
    if (hasComment(expr)) {
      return false;
    }

    // Allow `x` and `this`
    if (expr.type === "Identifier" || expr.type === "ThisExpression") {
      return true;
    }

    if (expr.type === "ChainExpression") {
      expr = expr.expression;
    }

    // Allow `a.b.c`, `a.b[c]`, and `this.x.y`
    if (isMemberExpression(expr)) {
      let head = expr;
      while (isMemberExpression(head)) {
        if (
          head.property.type !== "Identifier" &&
          head.property.type !== "Literal" &&
          head.property.type !== "StringLiteral" &&
          head.property.type !== "NumericLiteral"
        ) {
          return false;
        }
        head = head.object;
        if (hasComment(head)) {
          return false;
        }
      }

      if (head.type === "Identifier" || head.type === "ThisExpression") {
        return true;
      }

      return false;
    }

    return false;
  });
}

/**
 * @param {string} text
 * @param {Node} node
 * @returns {boolean}
 */
function hasLeadingOwnLineComment(text, node) {
  if (isJsxElement(node)) {
    return hasNodeIgnoreComment(node);
  }

  return hasComment(node, CommentCheckFlags.Leading, (comment) =>
    hasNewline(text, locEnd(comment)),
  );
}

// Note: Quoting/unquoting numbers in TypeScript is not safe.
//
// let a = { 1: 1, 2: 2 }
// let b = { '1': 1, '2': 2 }
//
// declare let aa: keyof typeof a;
// declare let bb: keyof typeof b;
//
// aa = bb;
// ^^
// Type '"1" | "2"' is not assignable to type '1 | 2'.
//   Type '"1"' is not assignable to type '1 | 2'.(2322)
//
// And in Flow, you get:
//
// const x = {
//   0: 1
//   ^ Non-string literal property keys not supported. [unsupported-syntax]
// }
//
// Angular does not support unquoted numbers in expressions.
//
// So we play it safe and only unquote numbers for the JavaScript parsers.
// (Vue supports unquoted numbers in expressions, but let’s keep it simple.)
//
// Identifiers can be unquoted in more circumstances, though.
function isStringPropSafeToUnquote(node, options) {
  return (
    options.parser !== "json" &&
    isStringLiteral(node.key) &&
    rawText(node.key).slice(1, -1) === node.key.value &&
    ((isEs5IdentifierName(node.key.value) &&
      // With `--strictPropertyInitialization`, TS treats properties with quoted names differently than unquoted ones.
      // See https://github.com/microsoft/TypeScript/pull/20075
      !(
        (options.parser === "babel-ts" && node.type === "ClassProperty") ||
        (options.parser === "typescript" && node.type === "PropertyDefinition")
      )) ||
      (isSimpleNumber(node.key.value) &&
        String(Number(node.key.value)) === node.key.value &&
        (options.parser === "babel" ||
          options.parser === "acorn" ||
          options.parser === "espree" ||
          options.parser === "meriyah" ||
          options.parser === "__babel_estree")))
  );
}

// Matches “simple” numbers like `123` and `2.5` but not `1_000`, `1e+100` or `0b10`.
function isSimpleNumber(numberString) {
  return /^(?:\d+|\d+\.\d+)$/.test(numberString);
}

/**
 * @param {TemplateLiteral} template
 * @returns {boolean}
 */
function templateLiteralHasNewLines(template) {
  return template.quasis.some((quasi) => quasi.value.raw.includes("\n"));
}

/**
 * @param {TemplateLiteral | TaggedTemplateExpression} node
 * @param {string} text
 * @returns {boolean}
 */
function isTemplateOnItsOwnLine(node, text) {
  return (
    ((node.type === "TemplateLiteral" && templateLiteralHasNewLines(node)) ||
      (node.type === "TaggedTemplateExpression" &&
        templateLiteralHasNewLines(node.quasi))) &&
    !hasNewline(text, locStart(node), { backwards: true })
  );
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function needsHardlineAfterDanglingComment(node) {
  if (!hasComment(node)) {
    return false;
  }
  const lastDanglingComment = getComments(node, CommentCheckFlags.Dangling).at(
    -1,
  );
  return lastDanglingComment && !isBlockComment(lastDanglingComment);
}

// Logic to check for args with multiple anonymous functions. For instance,
// the following call should be split on multiple lines for readability:
// source.pipe(map((x) => x + x), filter((x) => x % 2 === 0))
function isFunctionCompositionArgs(args) {
  if (args.length <= 1) {
    return false;
  }
  let count = 0;
  for (const arg of args) {
    if (isFunctionOrArrowExpression(arg)) {
      count += 1;
      if (count > 1) {
        return true;
      }
    } else if (isCallExpression(arg)) {
      for (const childArg of arg.arguments) {
        if (isFunctionOrArrowExpression(childArg)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Logic to determine if a call is a “long curried function call”.
// See https://github.com/prettier/prettier/issues/1420.
//
// `connect(a, b, c)(d)`
// In the above call expression, the second call is the parent node and the
// first call is the current node.
/**
 * @param {AstPath} path
 * @returns {boolean}
 */
function isLongCurriedCallExpression(path) {
  const { node, parent, key } = path;
  return (
    key === "callee" &&
    isCallExpression(node) &&
    isCallExpression(parent) &&
    parent.arguments.length > 0 &&
    node.arguments.length > parent.arguments.length
  );
}

const simpleCallArgumentUnaryOperators = new Set(["!", "-", "+", "~"]);

/**
 * @param {any} node
 * @param {number} depth
 * @returns {boolean}
 */
function isSimpleCallArgument(node, depth = 2) {
  if (depth <= 0) {
    return false;
  }

  const isChildSimple = (child) => isSimpleCallArgument(child, depth - 1);

  if (isRegExpLiteral(node)) {
    return getStringWidth(node.pattern ?? node.regex.pattern) <= 5;
  }

  if (
    node.type === "Literal" ||
    node.type === "BigIntLiteral" ||
    node.type === "DecimalLiteral" ||
    node.type === "BooleanLiteral" ||
    node.type === "NullLiteral" ||
    node.type === "NumericLiteral" ||
    node.type === "StringLiteral" ||
    node.type === "Identifier" ||
    node.type === "ThisExpression" ||
    node.type === "Super" ||
    node.type === "PrivateName" ||
    node.type === "PrivateIdentifier" ||
    node.type === "ArgumentPlaceholder" ||
    node.type === "Import"
  ) {
    return true;
  }

  if (node.type === "TemplateLiteral") {
    return (
      node.quasis.every((element) => !element.value.raw.includes("\n")) &&
      node.expressions.every(isChildSimple)
    );
  }

  if (isObjectOrRecordExpression(node)) {
    return node.properties.every(
      (p) =>
        !p.computed && (p.shorthand || (p.value && isChildSimple(p.value))),
    );
  }

  if (isArrayOrTupleExpression(node)) {
    return node.elements.every((x) => x === null || isChildSimple(x));
  }

  if (isCallLikeExpression(node)) {
    if (
      node.type === "ImportExpression" ||
      isSimpleCallArgument(node.callee, depth)
    ) {
      const args = getCallArguments(node);
      return args.length <= depth && args.every(isChildSimple);
    }
    return false;
  }

  if (isMemberExpression(node)) {
    return (
      isSimpleCallArgument(node.object, depth) &&
      isSimpleCallArgument(node.property, depth)
    );
  }

  if (
    (node.type === "UnaryExpression" &&
      simpleCallArgumentUnaryOperators.has(node.operator)) ||
    node.type === "UpdateExpression"
  ) {
    return isSimpleCallArgument(node.argument, depth);
  }

  if (node.type === "TSNonNullExpression") {
    return isSimpleCallArgument(node.expression, depth);
  }

  return false;
}

function rawText(node) {
  return node.extra?.raw ?? node.raw;
}

function identity(x) {
  return x;
}

/**
 * @param {any} options
 * @param {("es5" | "all")} [level]
 * @returns {boolean}
 */
function shouldPrintComma(options, level = "es5") {
  return (
    (options.trailingComma === "es5" && level === "es5") ||
    (options.trailingComma === "all" && (level === "all" || level === "es5"))
  );
}

/**
 * Tests if the leftmost node of the expression matches the predicate. E.g.,
 * used to check whether an expression statement needs to be wrapped in extra
 * parentheses because it starts with:
 *
 * - `{`
 * - `function`, `class`, or `do {}`
 * - `let[`
 *
 * Will be overzealous if there already are necessary grouping parentheses.
 *
 * @param {Node} node
 * @param {(leftmostNode: Node) => boolean} predicate
 * @returns {boolean}
 */
function startsWithNoLookaheadToken(node, predicate) {
  switch (node.type) {
    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
    case "NGPipeExpression":
      return startsWithNoLookaheadToken(node.left, predicate);
    case "MemberExpression":
    case "OptionalMemberExpression":
      return startsWithNoLookaheadToken(node.object, predicate);
    case "TaggedTemplateExpression":
      if (node.tag.type === "FunctionExpression") {
        // IIFEs are always already parenthesized
        return false;
      }
      return startsWithNoLookaheadToken(node.tag, predicate);
    case "CallExpression":
    case "OptionalCallExpression":
      if (node.callee.type === "FunctionExpression") {
        // IIFEs are always already parenthesized
        return false;
      }
      return startsWithNoLookaheadToken(node.callee, predicate);
    case "ConditionalExpression":
      return startsWithNoLookaheadToken(node.test, predicate);
    case "UpdateExpression":
      return (
        !node.prefix && startsWithNoLookaheadToken(node.argument, predicate)
      );
    case "BindExpression":
      return node.object && startsWithNoLookaheadToken(node.object, predicate);
    case "SequenceExpression":
      return startsWithNoLookaheadToken(node.expressions[0], predicate);
    case "ChainExpression":
    case "TSSatisfiesExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
      return startsWithNoLookaheadToken(node.expression, predicate);
    default:
      return predicate(node);
  }
}

const equalityOperators = {
  "==": true,
  "!=": true,
  "===": true,
  "!==": true,
};
const multiplicativeOperators = {
  "*": true,
  "/": true,
  "%": true,
};
const bitshiftOperators = {
  ">>": true,
  ">>>": true,
  "<<": true,
};

function shouldFlatten(parentOp, nodeOp) {
  if (getPrecedence(nodeOp) !== getPrecedence(parentOp)) {
    return false;
  }

  // ** is right-associative
  // x ** y ** z --> x ** (y ** z)
  if (parentOp === "**") {
    return false;
  }

  // x == y == z --> (x == y) == z
  if (equalityOperators[parentOp] && equalityOperators[nodeOp]) {
    return false;
  }

  // x * y % z --> (x * y) % z
  if (
    (nodeOp === "%" && multiplicativeOperators[parentOp]) ||
    (parentOp === "%" && multiplicativeOperators[nodeOp])
  ) {
    return false;
  }

  // x * y / z --> (x * y) / z
  // x / y * z --> (x / y) * z
  if (
    nodeOp !== parentOp &&
    multiplicativeOperators[nodeOp] &&
    multiplicativeOperators[parentOp]
  ) {
    return false;
  }

  // x << y << z --> (x << y) << z
  if (bitshiftOperators[parentOp] && bitshiftOperators[nodeOp]) {
    return false;
  }

  return true;
}

const PRECEDENCE = new Map(
  [
    ["|>"],
    ["??"],
    ["||"],
    ["&&"],
    ["|"],
    ["^"],
    ["&"],
    ["==", "===", "!=", "!=="],
    ["<", ">", "<=", ">=", "in", "instanceof"],
    [">>", "<<", ">>>"],
    ["+", "-"],
    ["*", "/", "%"],
    ["**"],
  ].flatMap((operators, index) =>
    operators.map((operator) => [operator, index]),
  ),
);
function getPrecedence(operator) {
  return PRECEDENCE.get(operator);
}

function isBitwiseOperator(operator) {
  return (
    Boolean(bitshiftOperators[operator]) ||
    operator === "|" ||
    operator === "^" ||
    operator === "&"
  );
}

function hasRestParameter(node) {
  if (node.rest) {
    return true;
  }
  const parameters = getFunctionParameters(node);
  return parameters.at(-1)?.type === "RestElement";
}

const functionParametersCache = new WeakMap();
function getFunctionParameters(node) {
  if (functionParametersCache.has(node)) {
    return functionParametersCache.get(node);
  }
  const parameters = [];
  if (node.this) {
    parameters.push(node.this);
  }
  // `params` vs `parameters` - see https://github.com/babel/babel/issues/9231
  if (Array.isArray(node.parameters)) {
    parameters.push(...node.parameters);
  } else if (Array.isArray(node.params)) {
    parameters.push(...node.params);
  }
  if (node.rest) {
    parameters.push(node.rest);
  }
  functionParametersCache.set(node, parameters);
  return parameters;
}

function iterateFunctionParametersPath(path, iteratee) {
  const { node } = path;
  let index = 0;
  const callback = (childPath) => iteratee(childPath, index++);
  if (node.this) {
    path.call(callback, "this");
  }
  if (Array.isArray(node.parameters)) {
    path.each(callback, "parameters");
  } else if (Array.isArray(node.params)) {
    path.each(callback, "params");
  }
  if (node.rest) {
    path.call(callback, "rest");
  }
}

const callArgumentsCache = new WeakMap();
function getCallArguments(node) {
  if (callArgumentsCache.has(node)) {
    return callArgumentsCache.get(node);
  }

  let args = node.arguments;
  if (node.type === "ImportExpression") {
    args = [node.source];

    if (node.attributes) {
      args.push(node.attributes);
    }
  }

  callArgumentsCache.set(node, args);
  return args;
}

function iterateCallArgumentsPath(path, iteratee) {
  const { node } = path;
  if (node.type === "ImportExpression") {
    path.call((sourcePath) => iteratee(sourcePath, 0), "source");

    if (node.attributes) {
      path.call((sourcePath) => iteratee(sourcePath, 1), "attributes");
    }
  } else {
    path.each(iteratee, "arguments");
  }
}

function getCallArgumentSelector(node, index) {
  if (node.type === "ImportExpression") {
    if (index === 0 || index === (node.attributes ? -2 : -1)) {
      return "source";
    }
    if (node.attributes && (index === 1 || index === -1)) {
      return "attributes";
    }
    throw new RangeError("Invalid argument index");
  }
  if (index < 0) {
    index = node.arguments.length + index;
  }
  /* c8 ignore next 3 */
  if (index < 0 || index >= node.arguments.length) {
    throw new RangeError("Invalid argument index");
  }
  return ["arguments", index];
}

function isPrettierIgnoreComment(comment) {
  return comment.value.trim() === "prettier-ignore" && !comment.unignore;
}

function hasNodeIgnoreComment(node) {
  return (
    node?.prettierIgnore || hasComment(node, CommentCheckFlags.PrettierIgnore)
  );
}

/** @enum {number} */
const CommentCheckFlags = {
  /** Check comment is a leading comment */
  Leading: 1 << 1,
  /** Check comment is a trailing comment */
  Trailing: 1 << 2,
  /** Check comment is a dangling comment */
  Dangling: 1 << 3,
  /** Check comment is a block comment */
  Block: 1 << 4,
  /** Check comment is a line comment */
  Line: 1 << 5,
  /** Check comment is a `prettier-ignore` comment */
  PrettierIgnore: 1 << 6,
  /** Check comment is the first attached comment */
  First: 1 << 7,
  /** Check comment is the last attached comment */
  Last: 1 << 8,
};

const getCommentTestFunction = (flags, fn) => {
  if (typeof flags === "function") {
    fn = flags;
    flags = 0;
  }
  if (flags || fn) {
    return (comment, index, comments) =>
      !(
        (flags & CommentCheckFlags.Leading && !comment.leading) ||
        (flags & CommentCheckFlags.Trailing && !comment.trailing) ||
        (flags & CommentCheckFlags.Dangling &&
          (comment.leading || comment.trailing)) ||
        (flags & CommentCheckFlags.Block && !isBlockComment(comment)) ||
        (flags & CommentCheckFlags.Line && !isLineComment(comment)) ||
        (flags & CommentCheckFlags.First && index !== 0) ||
        (flags & CommentCheckFlags.Last && index !== comments.length - 1) ||
        (flags & CommentCheckFlags.PrettierIgnore &&
          !isPrettierIgnoreComment(comment)) ||
        (fn && !fn(comment))
      );
  }
};
/**
 * @param {Node} node
 * @param {number | function} [flags]
 * @param {function} [fn]
 * @returns {boolean}
 */
function hasComment(node, flags, fn) {
  if (!isNonEmptyArray(node?.comments)) {
    return false;
  }
  const test = getCommentTestFunction(flags, fn);
  return test ? node.comments.some(test) : true;
}

/**
 * @param {Node} node
 * @param {number | function} [flags]
 * @param {function} [fn]
 * @returns {Comment[]}
 */
function getComments(node, flags, fn) {
  if (!Array.isArray(node?.comments)) {
    return [];
  }
  const test = getCommentTestFunction(flags, fn);
  return test ? node.comments.filter(test) : node.comments;
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
const isNextLineEmpty = (node, { originalText }) =>
  isNextLineEmptyAfterIndex(originalText, locEnd(node));

function isCallLikeExpression(node) {
  return (
    isCallExpression(node) ||
    node.type === "NewExpression" ||
    node.type === "ImportExpression"
  );
}

function isObjectProperty(node) {
  return (
    node &&
    (node.type === "ObjectProperty" ||
      (node.type === "Property" && !node.method && node.kind === "init"))
  );
}

/**
 * This is used as a marker for dangling comments.
 */
const markerForIfWithoutBlockAndSameLineComment = Symbol(
  "ifWithoutBlockAndSameLineComment",
);

const isTSTypeExpression = createTypeCheckFunction([
  "TSAsExpression",
  "TSSatisfiesExpression",
]);

export {
  getFunctionParameters,
  iterateFunctionParametersPath,
  getCallArguments,
  iterateCallArgumentsPath,
  getCallArgumentSelector,
  hasRestParameter,
  getLeftSide,
  getLeftSidePathName,
  hasLeadingOwnLineComment,
  hasNakedLeftSide,
  hasNode,
  hasNodeIgnoreComment,
  identity,
  isBinaryish,
  isCallLikeExpression,
  isLineComment,
  isPrettierIgnoreComment,
  isCallExpression,
  isMemberExpression,
  isExportDeclaration,
  isFunctionCompositionArgs,
  isFunctionNotation,
  isFunctionOrArrowExpression,
  isGetterOrSetter,
  isJsxElement,
  isLongCurriedCallExpression,
  isSimpleCallArgument,
  isMemberish,
  isNumericLiteral,
  isSignedNumericLiteral,
  isObjectProperty,
  isObjectType,
  isObjectTypePropertyAFunction,
  isRegExpLiteral,
  isSimpleType,
  isSimpleNumber,
  isSimpleTemplateLiteral,
  isStringLiteral,
  isStringPropSafeToUnquote,
  isTemplateOnItsOwnLine,
  isTestCall,
  isTypeAnnotationAFunction,
  isNextLineEmpty,
  needsHardlineAfterDanglingComment,
  rawText,
  shouldPrintComma,
  isBitwiseOperator,
  shouldFlatten,
  startsWithNoLookaheadToken,
  getPrecedence,
  hasComment,
  getComments,
  CommentCheckFlags,
  markerForIfWithoutBlockAndSameLineComment,
  isTSTypeExpression,
  isArrayOrTupleExpression,
  isObjectOrRecordExpression,
  createTypeCheckFunction,
};
