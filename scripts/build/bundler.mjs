import path from "node:path";
import fs from "node:fs";
import { rollup } from "rollup";
import webpack from "webpack";
import { nodeResolve as rollupPluginNodeResolve } from "@rollup/plugin-node-resolve";
import rollupPluginAlias from "@rollup/plugin-alias";
import rollupPluginCommonjs from "@rollup/plugin-commonjs";
import rollupPluginPolyfillNode from "rollup-plugin-polyfill-node";
import rollupPluginJson from "@rollup/plugin-json";
import rollupPluginReplace from "@rollup/plugin-replace";
import { terser as rollupPluginTerser } from "rollup-plugin-terser";
import { babel as rollupPluginBabel } from "@rollup/plugin-babel";
import WebpackPluginTerser from "terser-webpack-plugin";
import createEsmUtils from "esm-utils";
import builtinModules from "builtin-modules";
import { PROJECT_ROOT, DIST_DIR } from "../utils/index.mjs";
import rollupPluginExecutable from "./rollup-plugins/executable.mjs";
import rollupPluginEvaluate from "./rollup-plugins/evaluate.mjs";
import rollupPluginReplaceModule from "./rollup-plugins/replace-module.mjs";
import bundles from "./config.mjs";

const { __dirname, json } = createEsmUtils(import.meta);
const packageJson = json.loadSync("../../package.json");

const entries = [
  // Force using the CJS file, instead of ESM; i.e. get the file
  // from `"main"` instead of `"module"` (rollup default) of package.json
  {
    find: "@angular/compiler/src",
    replacement: path.resolve(
      `${PROJECT_ROOT}/node_modules/@angular/compiler/esm2015/src`
    ),
  },
];

function webpackNativeShims(config, modules) {
  if (!config.resolve) {
    config.resolve = {};
  }
  const { resolve } = config;
  resolve.alias = resolve.alias || {};
  resolve.fallback = resolve.fallback || {};
  for (const module of modules) {
    if (module in resolve.alias || module in resolve.fallback) {
      throw new Error(`fallback/alias for "${module}" already exists.`);
    }
    const file = path.join(__dirname, `shims/${module}.mjs`);
    if (fs.existsSync(file)) {
      resolve.alias[module] = file;
    } else {
      resolve.fallback[module] = false;
    }
  }
  return config;
}

function getBabelConfig(bundle) {
  const config = {
    babelrc: false,
    assumptions: {
      setSpreadProperties: true,
    },
    sourceType: "unambiguous",
    plugins: bundle.babelPlugins || [],
    compact: bundle.type === "plugin" ? false : "auto",
    exclude: [/\/core-js\//],
  };
  const targets = { node: "10" };
  if (bundle.target === "universal") {
    targets.browsers = packageJson.browserslist;
  }
  config.presets = [
    [
      "@babel/preset-env",
      {
        targets,
        exclude: [
          "es.array.unscopables.flat-map",
          "es.promise",
          "es.promise.finally",
          "es.string.replace",
          "es.symbol.description",
          "es.typed-array.*",
          "web.*",
        ],
        modules: false,
        useBuiltIns: "usage",
        corejs: {
          version: 3,
        },
        debug: false,
      },
    ],
  ];
  config.plugins.push([
    "@babel/plugin-proposal-object-rest-spread",
    { useBuiltIns: true },
  ]);
  return config;
}

function getRollupConfig(bundle) {
  const config = {
    input: path.join(PROJECT_ROOT, bundle.input),
    onwarn(warning) {
      if (
        // ignore `MIXED_EXPORTS` warn
        warning.code === "MIXED_EXPORTS" ||
        (warning.code === "CIRCULAR_DEPENDENCY" &&
          (warning.importer.startsWith("node_modules") ||
            warning.importer.startsWith("\x00polyfill-node."))) ||
        warning.code === "SOURCEMAP_ERROR" ||
        warning.code === "THIS_IS_UNDEFINED"
      ) {
        return;
      }

      // web bundle can't have external requires
      if (
        warning.code === "UNRESOLVED_IMPORT" &&
        bundle.target === "universal"
      ) {
        throw new Error(
          `Unresolved dependency in universal bundle: ${warning.source}`
        );
      }

      console.warn(warning);
    },
    external: [],
  };

  const replaceStrings = {
    "process.env.PRETTIER_TARGET": JSON.stringify(bundle.target),
    "process.env.NODE_ENV": JSON.stringify("production"),
  };
  if (bundle.target === "universal") {
    // We can't reference `process` in UMD bundles and this is
    // an undocumented "feature"
    replaceStrings["process.env.PRETTIER_DEBUG"] = "global.PRETTIER_DEBUG";
    // `rollup-plugin-node-globals` replace `__dirname` with the real dirname
    // `parser-typescript.js` will contain a path of working directory
    // See #8268
    replaceStrings.__filename = JSON.stringify(
      "/prettier-security-filename-placeholder.js"
    );
    replaceStrings.__dirname = JSON.stringify(
      "/prettier-security-dirname-placeholder"
    );
  }
  Object.assign(replaceStrings, bundle.replace);

  const babelConfig = { babelHelpers: "bundled", ...getBabelConfig(bundle) };

  const alias = { ...bundle.alias };
  alias.entries = [...entries, ...(alias.entries || [])];

  const replaceModule = {};
  // Replace other bundled files
  if (bundle.target === "node") {
    // Replace package.json with dynamic `require("./package.json")`
    replaceModule[path.join(PROJECT_ROOT, "package.json")] = "./package.json";

    // Dynamic require bundled files
    for (const item of bundles) {
      if (item.input !== bundle.input) {
        replaceModule[path.join(PROJECT_ROOT, item.input)] = `./${item.output}`;
      }
    }
  } else {
    // Universal bundle only use version info from package.json
    // Replace package.json with `{version: "{VERSION}"}`
    replaceModule[path.join(PROJECT_ROOT, "package.json")] = {
      code: `export default ${JSON.stringify({
        version: packageJson.version,
      })};`,
    };

    // Replace parser getters with `undefined`
    for (const file of [
      "src/language-css/parsers.js",
      "src/language-graphql/parsers.js",
      "src/language-handlebars/parsers.js",
      "src/language-html/parsers.js",
      "src/language-js/parse/parsers.js",
      "src/language-markdown/parsers.js",
      "src/language-yaml/parsers.js",
    ]) {
      replaceModule[path.join(PROJECT_ROOT, file)] = {
        code: "export default undefined;",
      };
    }
  }

  Object.assign(replaceModule, bundle.replaceModule);

  config.plugins = [
    rollupPluginReplace({
      values: replaceStrings,
      delimiters: ["", ""],
      preventAssignment: true,
    }),
    rollupPluginExecutable(),
    rollupPluginEvaluate(),
    rollupPluginJson({
      exclude: Object.keys(replaceModule)
        .filter((file) => file.endsWith(".json"))
        .map((file) => path.relative(PROJECT_ROOT, file)),
    }),
    rollupPluginAlias(alias),
    rollupPluginNodeResolve({
      extensions: [".js", ".json"],
      preferBuiltins: bundle.target === "node",
      mainFields: ["main"],
    }),
    rollupPluginCommonjs({
      ignoreGlobal: bundle.target === "node",
      ignore:
        bundle.type === "plugin"
          ? undefined
          : (id) => /\.\/parser-.*?/.test(id),
      requireReturnsDefault: "preferred",
      ignoreDynamicRequires: true,
      ignoreTryCatch: bundle.target === "node",
      ...bundle.commonjs,
    }),
    rollupPluginReplaceModule(replaceModule),
    bundle.target === "universal" && rollupPluginPolyfillNode(),
    rollupPluginBabel(babelConfig),
  ].filter(Boolean);

  if (bundle.target === "node") {
    config.external.push(...builtinModules);
  }
  if (bundle.external) {
    config.external.push(...bundle.external);
  }

  return config;
}

function getRollupOutputOptions(bundle, buildOptions) {
  const options = {
    // Avoid warning form #8797
    exports: "auto",
    file: path.join(DIST_DIR, bundle.output),
    name: bundle.name,
    plugins: [],
  };

  let shouldMinify = buildOptions.minify;
  if (typeof shouldMinify !== "boolean") {
    shouldMinify = bundle.minify !== false && bundle.target === "universal";
  }

  if (shouldMinify) {
    options.plugins.push(
      rollupPluginTerser({
        output: {
          ascii_only: true,
        },
      })
    );
  }

  if (bundle.target === "node") {
    options.format = "cjs";
  } else if (bundle.target === "universal") {
    if (!bundle.format && bundle.bundler !== "webpack") {
      return [
        {
          ...options,
          format: "umd",
        },
        !buildOptions.playground && {
          ...options,
          format: "esm",
          file: path.join(
            DIST_DIR,
            `esm/${bundle.output.replace(".js", ".mjs")}`
          ),
        },
      ].filter(Boolean);
    }
    options.format = bundle.format;
  }

  if (buildOptions.playground && bundle.bundler !== "webpack") {
    return { skipped: true };
  }

  return [options];
}

function getWebpackConfig(bundle, buildOptions) {
  if (bundle.type !== "plugin" || bundle.target !== "universal") {
    throw new Error("Must use rollup for this bundle");
  }

  const config = {
    mode: "production",
    performance: { hints: false },
    entry: path.resolve(PROJECT_ROOT, bundle.input),
    module: {
      rules: [
        {
          test: /\.js$/,
          use: {
            loader: "babel-loader",
            options: getBabelConfig(bundle),
          },
        },
        {
          test: /\.js$/,
          use: {
            loader: "string-replace-loader",
            options: {
              multiple: Object.entries(bundle.replace).map(
                ([search, replace]) => ({ search, replace })
              ),
            },
          },
        },
      ],
    },
    output: {
      path: DIST_DIR,
      filename: bundle.output,
      library: {
        type: "umd",
        name: bundle.name.split("."),
      },
      // https://github.com/webpack/webpack/issues/6642
      globalObject: 'new Function("return this")()',
    },
    optimization: {},
    resolve: {
      // Webpack@5 can't resolve "postcss/lib/parser" and "postcss/lib/stringifier"" imported by `postcss-scss`
      // Ignore `exports` field to fix bundle script
      exportsFields: [],
    },
  };

  let shouldMinify = buildOptions.minify;
  if (typeof shouldMinify !== "boolean") {
    shouldMinify = true;
  }

  if (shouldMinify) {
    config.optimization.minimizer = [
      new WebpackPluginTerser({
        // prevent terser generate extra .LICENSE file
        extractComments: false,
        terserOptions: {
          // prevent U+FFFE in the output
          output: {
            ascii_only: true,
          },
        },
      }),
    ];
  } else {
    config.optimization.minimize = false;
  }

  return webpackNativeShims(config, ["os", "path", "util", "url", "fs"]);
}

function runWebpack(config) {
  return new Promise((resolve, reject) => {
    webpack(config, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }

      if (stats.hasErrors()) {
        const { errors } = stats.toJson();
        const error = new Error(errors[0].message);
        error.errors = errors;
        reject(error);
        return;
      }

      if (stats.hasWarnings()) {
        const { warnings } = stats.toJson();
        console.warn(warnings);
      }

      resolve();
    });
  });
}

async function createBundle(bundle, cache, options) {
  const inputOptions = getRollupConfig(bundle);
  const outputOptions = getRollupOutputOptions(bundle, options);

  if (!Array.isArray(outputOptions) && outputOptions.skipped) {
    return { skipped: true };
  }

  if (
    cache &&
    (
      await Promise.all(
        outputOptions.map((outputOption) =>
          cache.isCached(inputOptions, outputOption)
        )
      )
    ).every((cached) => cached)
  ) {
    return { cached: true };
  }

  if (bundle.bundler === "webpack") {
    await runWebpack(getWebpackConfig(bundle, options));
  } else {
    const result = await rollup(inputOptions);
    await Promise.all(outputOptions.map((option) => result.write(option)));
  }

  return { bundled: true };
}

export default createBundle;
