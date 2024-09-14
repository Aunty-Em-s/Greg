import { parse as parseGraphql } from "graphql/language/parser.mjs";
import createError from "../common/parser-create-error.js";
import { hasPragma } from "./pragma.js";
import { locStart, locEnd } from "./loc.js";

function parseComments(ast) {
  const comments = [];
  const { startToken, endToken } = ast.loc;
  for (let token = startToken; token !== endToken; token = token.next) {
    if (token.kind === "Comment") {
      comments.push(token);
    }
  }

  return comments;
}

const parseOptions = {
  allowLegacyFragmentVariables: true,
};

function createParseError(error) {
  if (error?.name === "GraphQLError") {
    const {
      message,
      locations: [start],
    } = error;
    return createError(message, { loc: { start }, cause: error });
  }

  /* c8 ignore next */
  return error;
}

function parse(text /*, options */) {
  /** @type {any} */
  let ast;
  try {
    ast = parseGraphql(text, parseOptions);
  } catch (error) {
    throw createParseError(error);
  }

  ast.comments = parseComments(ast);
  return ast;
}

export const graphql = {
  parse,
  astFormat: "graphql",
  hasPragma,
  locStart,
  locEnd,
};
