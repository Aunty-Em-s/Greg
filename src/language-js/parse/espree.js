import { createRequire } from "node:module";
import createError from "../../common/parser-create-error.js";
import tryCombinations from "../../utils/try-combinations.js";
import createParser from "./utils/create-parser.js";
import postprocess from "./postprocess/index.js";
import getSourceType from "./utils/get-source-type.js";

const require = createRequire(import.meta.url);

/** @type {import("espree").Options} */
const parseOptions = {
  ecmaVersion: "latest",
  range: true,
  loc: true,
  comment: true,
  tokens: true,
  sourceType: "module",
  ecmaFeatures: {
    jsx: true,
    globalReturn: true,
    impliedStrict: false,
  },
};

function createParseError(error) {
  const { message, lineNumber, column } = error;

  /* c8 ignore next 3 */
  if (typeof lineNumber !== "number") {
    return error;
  }

  return createError(message, {
    loc: { start: { line: lineNumber, column } },
    cause: error,
  });
}

function parse(text, options = {}) {
  const { parse: espreeParse } = require("espree");

  const sourceType = getSourceType(options);
  // prettier-ignore
  const combinations = (
    sourceType
      ? /** @type {const} */([sourceType])
      : /** @type {const} */(["module", "script"])
  ).map(
    (sourceType) => () => espreeParse(text, { ...parseOptions, sourceType })
  );

  let ast;
  try {
    ast = tryCombinations(combinations);
  } catch (/** @type {any} */ { errors: [error] }) {
    throw createParseError(error);
  }

  return postprocess(ast, { text });
}

export const espree = createParser(parse);
