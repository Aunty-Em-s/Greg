"use strict";

const flatten = require("lodash/flatten");
const createError = require("../common/parser-create-error");
const tryCombinations = require("../utils/try-combinations");
const {
  getNextNonSpaceNonCommentCharacterIndexWithStartIndex,
  getShebang,
} = require("../common/util");
const postprocess = require("./parse-postprocess");
const createParser = require("./parser/create-parser");

const parseOptions = {
  sourceType: "module",
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
  allowSuperOutsideMethod: true,
  allowUndeclaredExports: true,
  errorRecovery: true,
  createParenthesizedExpressions: true,
  plugins: [
    // When adding a plugin, please add a test in `tests/js/babel-plugins`,
    // To remove plugins, remove it here and run `yarn test tests/js/babel-plugins` to verify
    "doExpressions",
    "classProperties",
    "exportDefaultFrom",
    "functionBind",
    "functionSent",
    "classPrivateProperties",
    "throwExpressions",
    "classPrivateMethods",
    "v8intrinsic",
    "partialApplication",
    ["decorators", { decoratorsBeforeExport: false }],
    "privateIn",
    "importAssertions",
    ["recordAndTuple", { syntaxType: "hash" }],
    "decimal",
    "moduleStringNames",
    "classStaticBlock",
  ],
  tokens: true,
  ranges: true,
};
const pipelineOperatorPlugins = [
  ["pipelineOperator", { proposal: "smart" }],
  ["pipelineOperator", { proposal: "minimal" }],
  ["pipelineOperator", { proposal: "fsharp" }],
];

// Similar to babel
// https://github.com/babel/babel/pull/7934/files#diff-a739835084910b0ee3ea649df5a4d223R67
const FLOW_PRAGMA_REGEX = /@(?:no)?flow\b/;
function isFlowFile(text, options) {
  if (options.filepath && options.filepath.endsWith(".js.flow")) {
    return true;
  }

  const shebang = getShebang(text);
  if (shebang) {
    text = text.slice(shebang.length);
  }

  const firstNonSpaceNonCommentCharacterIndex = getNextNonSpaceNonCommentCharacterIndexWithStartIndex(
    text,
    0
  );

  if (firstNonSpaceNonCommentCharacterIndex !== false) {
    text = text.slice(0, firstNonSpaceNonCommentCharacterIndex);
  }

  return FLOW_PRAGMA_REGEX.test(text);
}

function parseWithOptions(parseMethod, text, options) {
  // Inline the require to avoid loading all the JS if we don't use it
  /** @type {import("@babel/parser").parse | import("@babel/parser").parseExpression} */
  const parse = require("@babel/parser")[parseMethod];
  const ast = parse(text, options);
  // @ts-ignore
  const error = ast.errors.find((error) => shouldRethrowRecoveredError(error));
  if (error) {
    throw error;
  }
  return ast;
}

function createParseError(error) {
  // babel error prints (l:c) with cols that are zero indexed
  // so we need our custom error
  const { message, loc } = error;

  return createError(message.replace(/ \(.*\)/, ""), {
    start: {
      line: loc ? loc.line : 0,
      column: loc ? loc.column + 1 : 0,
    },
  });
}

function createParse(parseMethod, ...pluginCombinations) {
  const commonPlugins = parseOptions.plugins;
  pluginCombinations =
    pluginCombinations.length > 0
      ? pluginCombinations.map((plugins) => [...commonPlugins, ...plugins])
      : [commonPlugins];

  return (text, parsers, opts = {}) => {
    if (opts.parser === "babel" && isFlowFile(text, opts)) {
      opts.parser = "babel-flow";
      return parseFlow(text, parsers, opts);
    }

    let combinations = pluginCombinations;
    if (text.includes("|>")) {
      combinations = flatten(
        pipelineOperatorPlugins.map((pipelineOperatorPlugin) =>
          combinations.map((plugins) => [...plugins, pipelineOperatorPlugin])
        )
      );
    }

    const sourceType =
      opts.__babelSourceType === "script" ? "script" : "module";
    const { result: ast, error } = tryCombinations(
      ...combinations.map((plugins) => () =>
        parseWithOptions(parseMethod, text, {
          ...parseOptions,
          sourceType,
          plugins,
        })
      )
    );

    if (!ast) {
      throw createParseError(error);
    }

    return postprocess(ast, { ...opts, originalText: text });
  };
}

const parse = createParse("parse", ["jsx", "flow"]);
const parseFlow = createParse("parse", [
  "jsx",
  ["flow", { all: true, enums: true }],
]);
const parseTypeScript = createParse(
  "parse",
  ["jsx", "typescript"],
  ["typescript"]
);
const parseExpression = createParse("parseExpression", ["jsx"]);

const messagesShouldThrow = new Set([
  // TSErrors.UnexpectedTypeAnnotation
  // https://github.com/babel/babel/blob/008fe25ae22e78288fbc637d41069bb4a1040987/packages/babel-parser/src/plugins/typescript/index.js#L95
  "Did not expect a type annotation here.",
  // ErrorMessages.ModuleAttributeDifferentFromType
  // https://github.com/babel/babel/blob/a023b6456cac4505096028f91c5b78829955bfc2/packages/babel-parser/src/parser/error-message.js#L92
  "The only accepted module attribute is `type`",
  // FlowErrors.UnexpectedTypeParameterBeforeAsyncArrowFunction
  // https://github.com/babel/babel/blob/a023b6456cac4505096028f91c5b78829955bfc2/packages/babel-parser/src/plugins/flow.js#L118
  "Type parameters must come after the async keyword, e.g. instead of `<T> async () => {}`, use `async <T>() => {}`",
  // Rethrow on omitted call arguments: foo("a", , "b");
  // ErrorMessages.UnexpectedToken
  "Unexpected token ','",
]);

function shouldRethrowRecoveredError(error) {
  const [, message] = error.message.match(/(.*?)\s*\(\d+:\d+\)/);
  // Only works for literal message
  return messagesShouldThrow.has(message);
}

function parseJson(text, parsers, opts) {
  const ast = parseExpression(text, parsers, opts);

  for (const comment of ast.comments) {
    assertJsonNode(comment);
  }
  assertJsonNode(ast);

  return ast;
}

function assertJsonNode(node, parent) {
  switch (node.type) {
    case "ArrayExpression":
      for (const element of node.elements) {
        assertJsonChildNode(element);
      }
      return;
    case "ObjectExpression":
      for (const property of node.properties) {
        assertJsonChildNode(property);
      }
      return;
    case "ObjectProperty":
      if (node.computed) {
        throw createJsonError("computed");
      }

      if (node.shorthand) {
        throw createJsonError("shorthand");
      }

      assertJsonChildNode(node.key);
      assertJsonChildNode(node.value);
      return;
    case "UnaryExpression":
      switch (node.operator) {
        case "+":
        case "-":
          return assertJsonChildNode(node.argument);
        default:
          throw createJsonError("operator");
      }
    case "Identifier":
      if (parent && parent.type === "ObjectProperty" && parent.key === node) {
        return;
      }
      throw createJsonError();
    case "NullLiteral":
    case "BooleanLiteral":
    case "NumericLiteral":
    case "StringLiteral":
      return;
    default:
      throw createJsonError();
  }

  function assertJsonChildNode(child) {
    return assertJsonNode(child, node);
  }

  function createJsonError(attribute) {
    const name = !attribute
      ? node.type
      : `${node.type} with ${attribute}=${JSON.stringify(node[attribute])}`;
    return createError(`${name} is not allowed in JSON.`, {
      start: {
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
      },
    });
  }
}

const babel = createParser(parse);
const babelExpression = createParser(parseExpression);

// Export as a plugin so we can reuse the same bundle for UMD loading
module.exports = {
  parsers: {
    babel,
    "babel-flow": createParser(parseFlow),
    "babel-ts": createParser(parseTypeScript),
    json: {
      ...babelExpression,
      hasPragma() {
        return true;
      },
    },
    json5: babelExpression,
    "json-stringify": createParser({
      parse: parseJson,
      astFormat: "estree-json",
    }),
    /** @internal */
    __js_expression: babelExpression,
    /** for vue filter */
    __vue_expression: babelExpression,
    /** for vue event binding to handle semicolon */
    __vue_event_binding: babel,
  },
};
