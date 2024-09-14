import isNonEmptyArray from "../../utils/is-non-empty-array.js";
import { join, line, group, indent, ifBreak } from "../../document/builders.js";
import { hasComment, identity, CommentCheckFlags } from "../utils/index.js";
import { getTypeParametersGroupId } from "./type-parameters.js";
import { printDeclareToken } from "./misc.js";

/**
 * @typedef {import("../../document/builders.js").Doc} Doc
 */

/*
- `TSInterfaceDeclaration`(TypeScript)
- `DeclareInterface`(flow)
- `InterfaceDeclaration`(flow)
- `InterfaceTypeAnnotation`(flow)
*/
function printInterface(path, options, print) {
  const { node } = path;
  /** @type {Doc[]} */
  const parts = [printDeclareToken(path), "interface"];

  const partsGroup = [];
  const extendsParts = [];

  if (node.type !== "InterfaceTypeAnnotation") {
    partsGroup.push(" ", print("id"), print("typeParameters"));
  }

  const shouldIndentOnlyHeritageClauses =
    node.typeParameters &&
    !hasComment(
      node.typeParameters,
      CommentCheckFlags.Trailing | CommentCheckFlags.Line,
    );

  if (isNonEmptyArray(node.extends)) {
    extendsParts.push(
      shouldIndentOnlyHeritageClauses
        ? ifBreak(" ", line, {
            groupId: getTypeParametersGroupId(node.typeParameters),
          })
        : line,
      "extends ",
      (node.extends.length === 1 ? identity : indent)(
        join([",", line], path.map(print, "extends")),
      ),
    );
  }

  if (
    hasComment(node.id, CommentCheckFlags.Trailing) ||
    isNonEmptyArray(node.extends)
  ) {
    if (shouldIndentOnlyHeritageClauses) {
      parts.push(group([...partsGroup, indent(extendsParts)]));
    } else {
      parts.push(group(indent([...partsGroup, ...extendsParts])));
    }
  } else {
    parts.push(...partsGroup, ...extendsParts);
  }

  parts.push(" ", print("body"));

  return group(parts);
}

export { printInterface };
