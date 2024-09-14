import {
  line,
  hardline,
  softline,
  group,
  fill,
  indent,
  dedent,
  breakParent,
} from "../../document/builders.js";
import {
  getPropOfDeclNode,
  insideValueFunctionNode,
  insideAtRuleNode,
  insideURLFunctionInImportAtRuleNode,
  isSCSSControlDirectiveNode,
  isRelationalOperatorNode,
  isEqualityOperatorNode,
  isMultiplicationNode,
  isDivisionNode,
  isAdditionNode,
  isSubtractionNode,
  isMathOperatorNode,
  isEachKeywordNode,
  isForKeywordNode,
  isIfElseKeywordNode,
  hasEmptyRawBefore,
  isPostcssSimpleVarNode,
  isInlineValueCommentNode,
  isHashNode,
  isLeftCurlyBraceNode,
  isRightCurlyBraceNode,
  isWordNode,
  isColonNode,
  isColorAdjusterFuncNode,
  isAtWordPlaceholderNode,
  isParenGroupNode,
} from "../utils/index.js";
import { locStart, locEnd } from "../loc.js";

function printCommaSeparatedValueGroup(path, options, print) {
  const { node } = path;
  const parentNode = path.parent;
  const parentParentNode = path.grandparent;
  const declAncestorProp = getPropOfDeclNode(path);
  const isGridValue =
    declAncestorProp &&
    parentNode.type === "value-value" &&
    (declAncestorProp === "grid" ||
      declAncestorProp.startsWith("grid-template"));
  const atRuleAncestorNode = path.findAncestor(
    (node) => node.type === "css-atrule",
  );
  const isControlDirective =
    atRuleAncestorNode &&
    isSCSSControlDirectiveNode(atRuleAncestorNode, options);
  const hasInlineComment = node.groups.some((node) =>
    isInlineValueCommentNode(node),
  );

  const printed = path.map(print, "groups");
  const parts = [];
  const insideURLFunction = insideValueFunctionNode(path, "url");

  let insideSCSSInterpolationInString = false;
  let didBreak = false;

  for (let i = 0; i < node.groups.length; ++i) {
    parts.push(printed[i]);

    const iPrevNode = node.groups[i - 1];
    const iNode = node.groups[i];
    const iNextNode = node.groups[i + 1];
    const iNextNextNode = node.groups[i + 2];

    if (insideURLFunction) {
      if ((iNextNode && isAdditionNode(iNextNode)) || isAdditionNode(iNode)) {
        parts.push(" ");
      }
      continue;
    }

    // Ignore SCSS @forward wildcard suffix
    if (
      insideAtRuleNode(path, "forward") &&
      iNode.type === "value-word" &&
      iNode.value &&
      iPrevNode !== undefined &&
      iPrevNode.type === "value-word" &&
      iPrevNode.value === "as" &&
      iNextNode.type === "value-operator" &&
      iNextNode.value === "*"
    ) {
      continue;
    }

    // Ignore after latest node (i.e. before semicolon)
    if (!iNextNode) {
      continue;
    }

    // styled.div` background: var(--${one}); `
    if (
      iNode.type === "value-word" &&
      iNode.value.endsWith("-") &&
      isAtWordPlaceholderNode(iNextNode)
    ) {
      continue;
    }

    // Ignore spaces before/after string interpolation (i.e. `"#{my-fn("_")}"`)
    if (iNode.type === "value-string" && iNode.quoted) {
      const positionOfOpeningInterpolation = iNode.value.lastIndexOf("#{");
      const positionOfClosingInterpolation = iNode.value.lastIndexOf("}");
      if (
        positionOfOpeningInterpolation !== -1 &&
        positionOfClosingInterpolation !== -1
      ) {
        insideSCSSInterpolationInString =
          positionOfOpeningInterpolation > positionOfClosingInterpolation;
      } else if (positionOfOpeningInterpolation !== -1) {
        insideSCSSInterpolationInString = true;
      } else if (positionOfClosingInterpolation !== -1) {
        insideSCSSInterpolationInString = false;
      }
    }

    if (insideSCSSInterpolationInString) {
      continue;
    }

    // Ignore colon (i.e. `:`)
    if (isColonNode(iNode) || isColonNode(iNextNode)) {
      continue;
    }

    // Ignore `@` in Less (i.e. `@@var;`)
    if (
      iNode.type === "value-atword" &&
      (iNode.value === "" ||
        /*
            @var[ @notVarNested ][notVar]
            ^^^^^
            */
        iNode.value.endsWith("["))
    ) {
      continue;
    }

    /*
    @var[ @notVarNested ][notVar]
                        ^^^^^^^^^
    */
    if (iNextNode.type === "value-word" && iNextNode.value.startsWith("]")) {
      continue;
    }

    // Ignore `~` in Less (i.e. `content: ~"^//* some horrible but needed css hack";`)
    if (iNode.value === "~") {
      continue;
    }

    // Ignore escape `\`
    if (
      iNode.type !== "value-string" &&
      iNode.value &&
      iNode.value.includes("\\") &&
      iNextNode &&
      iNextNode.type !== "value-comment"
    ) {
      continue;
    }

    // Ignore escaped `/`
    if (
      iPrevNode?.value &&
      iPrevNode.value.indexOf("\\") === iPrevNode.value.length - 1 &&
      iNode.type === "value-operator" &&
      iNode.value === "/"
    ) {
      continue;
    }

    // Ignore `\` (i.e. `$variable: \@small;`)
    if (iNode.value === "\\") {
      continue;
    }

    // Ignore `$$` (i.e. `background-color: $$(style)Color;`)
    if (isPostcssSimpleVarNode(iNode, iNextNode)) {
      continue;
    }

    // Ignore spaces after `#` and after `{` and before `}` in SCSS interpolation (i.e. `#{variable}`)
    if (
      isHashNode(iNode) ||
      isLeftCurlyBraceNode(iNode) ||
      isRightCurlyBraceNode(iNextNode) ||
      (isLeftCurlyBraceNode(iNextNode) && hasEmptyRawBefore(iNextNode)) ||
      (isRightCurlyBraceNode(iNode) && hasEmptyRawBefore(iNextNode))
    ) {
      continue;
    }

    // Ignore css variables and interpolation in SCSS (i.e. `--#{$var}`)
    if (iNode.value === "--" && isHashNode(iNextNode)) {
      continue;
    }

    // Formatting math operations
    const isMathOperator = isMathOperatorNode(iNode);
    const isNextMathOperator = isMathOperatorNode(iNextNode);

    // Print spaces before and after math operators beside SCSS interpolation as is
    // (i.e. `#{$var}+5`, `#{$var} +5`, `#{$var}+ 5`, `#{$var} + 5`)
    // (i.e. `5+#{$var}`, `5 +#{$var}`, `5+ #{$var}`, `5 + #{$var}`)
    if (
      ((isMathOperator && isHashNode(iNextNode)) ||
        (isNextMathOperator && isRightCurlyBraceNode(iNode))) &&
      hasEmptyRawBefore(iNextNode)
    ) {
      continue;
    }

    // absolute paths are only parsed as one token if they are part of url(/abs/path) call
    // but if you have custom -fb-url(/abs/path/) then it is parsed as "division /" and rest
    // of the path. We don't want to put a space after that first division in this case.
    if (!iPrevNode && isDivisionNode(iNode)) {
      continue;
    }

    // Print spaces before and after addition and subtraction math operators as is in `calc` function
    // due to the fact that it is not valid syntax
    // (i.e. `calc(1px+1px)`, `calc(1px+ 1px)`, `calc(1px +1px)`, `calc(1px + 1px)`)
    if (
      insideValueFunctionNode(path, "calc") &&
      (isAdditionNode(iNode) ||
        isAdditionNode(iNextNode) ||
        isSubtractionNode(iNode) ||
        isSubtractionNode(iNextNode)) &&
      hasEmptyRawBefore(iNextNode)
    ) {
      continue;
    }

    // Print spaces after `+` and `-` in color adjuster functions as is (e.g. `color(red l(+ 20%))`)
    // Adjusters with signed numbers (e.g. `color(red l(+20%))`) output as-is.
    const isColorAdjusterNode =
      (isAdditionNode(iNode) || isSubtractionNode(iNode)) &&
      i === 0 &&
      (iNextNode.type === "value-number" || iNextNode.isHex) &&
      parentParentNode &&
      isColorAdjusterFuncNode(parentParentNode) &&
      !hasEmptyRawBefore(iNextNode);

    const requireSpaceBeforeOperator =
      iNextNextNode?.type === "value-func" ||
      (iNextNextNode && isWordNode(iNextNextNode)) ||
      iNode.type === "value-func" ||
      isWordNode(iNode);
    const requireSpaceAfterOperator =
      iNextNode.type === "value-func" ||
      isWordNode(iNextNode) ||
      iPrevNode?.type === "value-func" ||
      (iPrevNode && isWordNode(iPrevNode));

    // Space before unary minus followed by a function call.
    if (
      options.parser === "scss" &&
      isMathOperator &&
      iNode.value === "-" &&
      iNextNode.type === "value-func"
    ) {
      parts.push(" ");
      continue;
    }

    // Formatting `/`, `+`, `-` sign
    if (
      !(isMultiplicationNode(iNextNode) || isMultiplicationNode(iNode)) &&
      !insideValueFunctionNode(path, "calc") &&
      !isColorAdjusterNode &&
      ((isDivisionNode(iNextNode) && !requireSpaceBeforeOperator) ||
        (isDivisionNode(iNode) && !requireSpaceAfterOperator) ||
        (isAdditionNode(iNextNode) && !requireSpaceBeforeOperator) ||
        (isAdditionNode(iNode) && !requireSpaceAfterOperator) ||
        isSubtractionNode(iNextNode) ||
        isSubtractionNode(iNode)) &&
      (hasEmptyRawBefore(iNextNode) ||
        (isMathOperator &&
          (!iPrevNode || (iPrevNode && isMathOperatorNode(iPrevNode)))))
    ) {
      continue;
    }

    // No space before unary minus followed by an opening parenthesis `-(`
    if (
      (options.parser === "scss" || options.parser === "less") &&
      isMathOperator &&
      iNode.value === "-" &&
      isParenGroupNode(iNextNode) &&
      locEnd(iNode) === locStart(iNextNode.open) &&
      iNextNode.open.value === "("
    ) {
      continue;
    }

    // Add `hardline` after inline comment (i.e. `// comment\n foo: bar;`)
    if (isInlineValueCommentNode(iNode)) {
      if (parentNode.type === "value-paren_group") {
        parts.push(dedent(hardline));
        continue;
      }
      parts.push(hardline);
      continue;
    }

    // Handle keywords in SCSS control directive
    if (
      isControlDirective &&
      (isEqualityOperatorNode(iNextNode) ||
        isRelationalOperatorNode(iNextNode) ||
        isIfElseKeywordNode(iNextNode) ||
        isEachKeywordNode(iNode) ||
        isForKeywordNode(iNode))
    ) {
      parts.push(" ");

      continue;
    }

    // At-rule `namespace` should be in one line
    if (
      atRuleAncestorNode &&
      atRuleAncestorNode.name.toLowerCase() === "namespace"
    ) {
      parts.push(" ");

      continue;
    }

    // Formatting `grid` property
    if (isGridValue) {
      if (
        iNode.source &&
        iNextNode.source &&
        iNode.source.start.line !== iNextNode.source.start.line
      ) {
        parts.push(hardline);

        didBreak = true;
      } else {
        parts.push(" ");
      }

      continue;
    }

    // Add `space` before next math operation
    // Note: `grip` property have `/` delimiter and it is not math operation, so
    // `grid` property handles above
    if (isNextMathOperator) {
      parts.push(" ");

      continue;
    }
    // allow function(returns-list($list)...)
    if (iNextNode?.value === "...") {
      continue;
    }

    if (
      isAtWordPlaceholderNode(iNode) &&
      isAtWordPlaceholderNode(iNextNode) &&
      locEnd(iNode) === locStart(iNextNode)
    ) {
      continue;
    }

    if (
      isAtWordPlaceholderNode(iNode) &&
      isParenGroupNode(iNextNode) &&
      locEnd(iNode) === locStart(iNextNode.open)
    ) {
      parts.push(softline);
      continue;
    }

    if (iNode.value === "with" && isParenGroupNode(iNextNode)) {
      parts.push(" ");
      continue;
    }

    if (
      iNode.value?.endsWith("#") &&
      iNextNode.value === "{" &&
      isParenGroupNode(iNextNode.group)
    ) {
      continue;
    }

    // Be default all values go through `line`
    parts.push(line);
  }

  if (hasInlineComment) {
    parts.push(breakParent);
  }

  if (didBreak) {
    parts.unshift(hardline);
  }

  if (isControlDirective) {
    return group(indent(parts));
  }

  // Indent is not needed for import url when url is very long
  // and node has two groups
  // when type is value-comma_group
  // example @import url("verylongurl") projection,tv
  if (insideURLFunctionInImportAtRuleNode(path)) {
    return group(fill(parts));
  }

  return group(indent(fill(parts)));
}

export default printCommaSeparatedValueGroup;
