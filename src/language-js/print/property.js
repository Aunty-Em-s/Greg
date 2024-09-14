import { printComments } from "../../main/comments/print.js";
import printString from "../../utils/print-string.js";
import printNumber from "../../utils/print-number.js";
import {
  isNumericLiteral,
  isSimpleNumber,
  isStringLiteral,
  isStringPropSafeToUnquote,
  rawText,
} from "../utils/index.js";
import { printAssignment } from "./assignment.js";

const needsQuoteProps = new WeakMap();

function printPropertyKey(path, options, print) {
  const { node } = path;

  if (node.computed) {
    return ["[", print("key"), "]"];
  }

  const { parent } = path;
  const { key } = node;

  if (options.quoteProps === "consistent" && !needsQuoteProps.has(parent)) {
    const objectHasStringProp = (
      parent.properties ||
      parent.body ||
      parent.members
    ).some(
      (prop) =>
        !prop.computed &&
        prop.key &&
        isStringLiteral(prop.key) &&
        !isStringPropSafeToUnquote(prop, options),
    );
    needsQuoteProps.set(parent, objectHasStringProp);
  }

  if (
    (key.type === "Identifier" ||
      (isNumericLiteral(key) &&
        isSimpleNumber(printNumber(rawText(key))) &&
        // Avoid converting 999999999999999999999 to 1e+21, 0.99999999999999999 to 1 and 1.0 to 1.
        String(key.value) === printNumber(rawText(key)) &&
        // Quoting number keys is safe in JS and Flow, but not in TypeScript (as
        // mentioned in `isStringPropSafeToUnquote`).
        !(options.parser === "typescript" || options.parser === "babel-ts"))) &&
    (options.parser === "json" ||
      (options.quoteProps === "consistent" && needsQuoteProps.get(parent)))
  ) {
    // a -> "a"
    // 1 -> "1"
    // 1.5 -> "1.5"
    const prop = printString(
      JSON.stringify(
        key.type === "Identifier" ? key.name : key.value.toString(),
      ),
      options,
    );
    return path.call((keyPath) => printComments(keyPath, prop, options), "key");
  }

  if (
    isStringPropSafeToUnquote(node, options) &&
    (options.quoteProps === "as-needed" ||
      (options.quoteProps === "consistent" && !needsQuoteProps.get(parent)))
  ) {
    // 'a' -> a
    // '1' -> 1
    // '1.5' -> 1.5
    return path.call(
      (keyPath) =>
        printComments(
          keyPath,
          /^\d/.test(key.value) ? printNumber(key.value) : key.value,
          options,
        ),
      "key",
    );
  }

  return print("key");
}

function printProperty(path, options, print) {
  const { node } = path;
  if (node.shorthand) {
    return print("value");
  }

  return printAssignment(
    path,
    options,
    print,
    printPropertyKey(path, options, print),
    ":",
    "value",
  );
}

export { printProperty, printPropertyKey };
