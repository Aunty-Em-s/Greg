import { parse } from "@babel/parser";
import { traverseFast as traverse } from "@babel/types";
import babelGenerator from "@babel/generator";
import { outdent } from "outdent";
import { SOURCE_DIR } from "../../utils/index.js";
import allTransforms from "./transforms/index.js";

const generate = babelGenerator.default;

/* Doesn't work for dependencies, optional call, computed property, and spread arguments */

function transform(original, file) {
  if (!file.startsWith(SOURCE_DIR)) {
    return original;
  }

  const transforms = allTransforms.filter(
    (transform) => !transform.shouldSkip(original, file),
  );

  if (transforms.length === 0) {
    return original;
  }

  let changed = false;
  const injected = new Set();

  const ast = parse(original, { sourceType: "module" });
  traverse(ast, (node) => {
    for (const transform of transforms) {
      if (!transform.test(node)) {
        continue;
      }

      transform.transform(node);

      if (transform.inject) {
        injected.add(transform.inject);
      }

      changed ||= true;
    }
  });

  if (!changed) {
    return original;
  }

  let { code } = generate(ast);

  if (injected.size > 0) {
    code = outdent`
      ${[...injected].join("\n")}

      ${code}
    `;
  }

  return code;
}

export default transform;
