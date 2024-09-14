import { join, line, group } from "../../document/builders.js";
import UnexpectedNodeError from "../../utils/unexpected-node-error.js";
import {
  hasNode,
  hasComment,
  getComments,
  createTypeCheckFunction,
} from "../utils/index.js";
import { printBinaryishExpression } from "./binaryish.js";

/** @typedef {import("../../common/ast-path.js").default} AstPath */

function printAngular(path, options, print) {
  const { node } = path;

  // Angular nodes always starts with `NG`
  if (!node.type.startsWith("NG")) {
    return;
  }

  switch (node.type) {
    case "NGRoot":
      return [
        print("node"),
        hasComment(node.node)
          ? " //" + getComments(node.node)[0].value.trimEnd()
          : "",
      ];
    case "NGPipeExpression":
      return printBinaryishExpression(path, options, print);
    case "NGChainedExpression":
      return group(
        join(
          [";", line],
          path.map(
            () => (hasNgSideEffect(path) ? print() : ["(", print(), ")"]),
            "expressions",
          ),
        ),
      );
    case "NGEmptyExpression":
      return "";
    case "NGMicrosyntax":
      return path.map(
        () => [
          path.isFirst ? "" : isNgForOf(path) ? " " : [";", line],
          print(),
        ],
        "body",
      );
    case "NGMicrosyntaxKey":
      return /^[$_a-z][\w$]*(?:-[$_a-z][\w$])*$/i.test(node.name)
        ? node.name
        : JSON.stringify(node.name);
    case "NGMicrosyntaxExpression":
      return [
        print("expression"),
        node.alias === null ? "" : [" as ", print("alias")],
      ];
    case "NGMicrosyntaxKeyedExpression": {
      const { index, parent } = path;
      const shouldNotPrintColon =
        isNgForOf(path) ||
        (((index === 1 &&
          (node.key.name === "then" || node.key.name === "else")) ||
          (index === 2 &&
            node.key.name === "else" &&
            parent.body[index - 1].type === "NGMicrosyntaxKeyedExpression" &&
            parent.body[index - 1].key.name === "then")) &&
          parent.body[0].type === "NGMicrosyntaxExpression");
      return [
        print("key"),
        shouldNotPrintColon ? " " : ": ",
        print("expression"),
      ];
    }
    case "NGMicrosyntaxLet":
      return [
        "let ",
        print("key"),
        node.value === null ? "" : [" = ", print("value")],
      ];
    case "NGMicrosyntaxAs":
      return [print("key"), " as ", print("alias")];
    default:
      /* c8 ignore next */
      throw new UnexpectedNodeError(node, "Angular");
  }
}

function isNgForOf({ node, index, parent }) {
  return (
    node.type === "NGMicrosyntaxKeyedExpression" &&
    node.key.name === "of" &&
    index === 1 &&
    parent.body[0].type === "NGMicrosyntaxLet" &&
    parent.body[0].value === null
  );
}

const hasSideEffect = createTypeCheckFunction([
  "CallExpression",
  "OptionalCallExpression",
  "AssignmentExpression",
]);
/** identify if an angular expression seems to have side effects */
/**
 * @param {AstPath} path
 * @returns {boolean}
 */
function hasNgSideEffect({ node }) {
  return hasNode(node, hasSideEffect);
}

export { printAngular };
