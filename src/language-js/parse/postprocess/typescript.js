"use strict";

const createError = require("../../../common/parser-create-error.js");
const visitNode = require("./visitNode.js");

function throwSyntaxError(node, message) {
  const { start, end } = node.loc;
  throw createError(message, {
    start: { line: start.line, column: start.column + 1 },
    end: { line: end.line, column: end.column + 1 },
  });
}

// Invalid decorators are removed since `@typescript-eslint/typescript-estree` v4
// https://github.com/typescript-eslint/typescript-eslint/pull/2375
function throwErrorForInvalidDecorator(
  tsNode,
  esTreeNode,
  tsNodeToESTreeNodeMap
) {
  const tsDecorators = tsNode.decorators;
  if (!Array.isArray(tsDecorators)) {
    return;
  }
  const esTreeDecorators = esTreeNode.decorators;
  if (
    !Array.isArray(esTreeDecorators) ||
    esTreeDecorators.length !== tsDecorators.length ||
    tsDecorators.some((tsDecorator) => {
      const esTreeDecorator = tsNodeToESTreeNodeMap.get(tsDecorator);
      return !esTreeDecorator || !esTreeDecorators.includes(esTreeDecorator);
    })
  ) {
    throwSyntaxError(
      esTreeNode,
      "Leading decorators must be attached to a class declaration"
    );
  }
}

// Values of abstract property is removed since `@typescript-eslint/typescript-estree` v5
// https://github.com/typescript-eslint/typescript-eslint/releases/tag/v5.0.0
function throwErrorForInvalidAbstractProperty(tsNode, esTreeNode) {
  const SYNTAX_KIND_PROPERTY_DEFINITION = 166;
  const SYNTAX_KIND_ABSTRACT_KEYWORD = 126;
  if (
    tsNode.kind !== SYNTAX_KIND_PROPERTY_DEFINITION ||
    (tsNode.modifiers &&
      !tsNode.modifiers.some(
        (modifier) => modifier.kind === SYNTAX_KIND_ABSTRACT_KEYWORD
      ))
  ) {
    return;
  }
  if (tsNode.initializer && esTreeNode.value === null) {
    throwSyntaxError(
      esTreeNode,
      "Abstract property cannot have an initializer"
    );
  }
}

function throwErrorForInvalidNodes(ast, options) {
  const { esTreeNodeToTSNodeMap, tsNodeToESTreeNodeMap } =
    options.tsParseResult;
  ast = visitNode(ast, (node) => {
    const tsNode = esTreeNodeToTSNodeMap.get(node);
    if (!tsNode) {
      return;
    }
    const esTreeNode = tsNodeToESTreeNodeMap.get(tsNode);
    if (esTreeNode !== node) {
      return;
    }
    throwErrorForInvalidDecorator(tsNode, esTreeNode, tsNodeToESTreeNodeMap);
    throwErrorForInvalidAbstractProperty(tsNode, esTreeNode);
  });
}

module.exports = { throwErrorForInvalidNodes };
