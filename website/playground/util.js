export function fixPrettierVersion(version) {
  const match = version.match(/^\d+\.\d+\.\d+-pr.(\d+)$/);
  if (match) {
    return `pr-${match[1]}`;
  }
  return version;
}

export function getDefaults(availableOptions, optionNames) {
  const defaults = {};
  for (const option of availableOptions) {
    if (optionNames.includes(option.name)) {
      defaults[option.name] =
        option.name === "parser" ? "babel" : option.default;
    }
  }
  return defaults;
}

export function buildCliArgs(availableOptions, options) {
  const args = [];
  for (const option of availableOptions) {
    const value = options[option.name];

    if (value === undefined) {
      continue;
    }

    if (option.type === "boolean") {
      if ((value && !option.inverted) || (!value && option.inverted)) {
        args.push([option.cliName, true]);
      }
    } else if (value !== option.default || option.name === "rangeStart") {
      args.push([option.cliName, value]);
    }
  }
  return args;
}

export function getCodemirrorMode(parser) {
  switch (parser) {
    case "css":
    case "less":
    case "scss":
      return "css";
    case "graphql":
      return "graphql";
    case "markdown":
      return "markdown";
    default:
      return "jsx";
  }
}

const astAutoFold = {
  estree: /^\s*"(loc|start|end|tokens|\w+Comments|comments)":/,
  postcss: /^\s*"(source|input|raws|file)":/,
  html: /^\s*"(\w+Span|valueTokens|tokens|file|tagDefinition)":/,
  mdast: /^\s*"position":/,
  yaml: /^\s*"position":/,
  glimmer: /^\s*"loc":/,
  graphql: /^\s*"loc":/,
};

export function getAstAutoFold(parser) {
  switch (parser) {
    case "flow":
    case "babel":
    case "babel-flow":
    case "babel-ts":
    case "typescript":
    case "acorn":
    case "espree":
    case "meriyah":
    case "json":
    case "json5":
    case "json-stringify":
      return astAutoFold.estree;
    case "css":
    case "less":
    case "scss":
      return astAutoFold.postcss;
    case "html":
    case "angular":
    case "vue":
    case "lwc":
      return astAutoFold.html;
    case "markdown":
    case "mdx":
      return astAutoFold.mdast;
    case "yaml":
      return astAutoFold.yaml;
    default:
      return astAutoFold[parser];
  }
}

export function convertSelectionToRange({ head, anchor }, content) {
  const lines = content.split("\n");
  return [head, anchor]
    .map(
      ({ ch, line }) =>
        lines.slice(0, line).join("\n").length + ch + (line ? 1 : 0),
    )
    .sort((a, b) => a - b);
}

export function convertOffsetToSelection(offset, content) {
  let line = 0;
  let ch = 0;
  for (let i = 0; i < offset && i <= content.length; i++) {
    if (content[i] === "\n") {
      line++;
      ch = 0;
    } else {
      ch++;
    }
  }
  return { anchor: { line, ch } };
}

/**
 * Copied from https://github.com/prettier/prettier/blob/6fe21780115cf5f74f83876d64b03a727fbab220/src/cli/utils.js#L6-L27
 * @template Obj
 * @template Key
 * @param {Array<Obj>} array
 * @param {(value: Obj) => Key} iteratee
 * @returns {{[p in Key]: T}}
 */
export function groupBy(array, iteratee) {
  const result = Object.create(null);

  for (const value of array) {
    const key = iteratee(value);

    if (Array.isArray(result[key])) {
      result[key].push(value);
    } else {
      result[key] = [value];
    }
  }

  return result;
}
