import prettier from "prettier-local";
import runPrettier from "../run-prettier.js";

describe("show version with --version", () => {
  runPrettier("cli/with-shebang", ["--version"]).test({
    stdout: prettier.version + "\n",
    status: 0,
  });
});

describe("show usage with --help", () => {
  runPrettier("cli", ["--help"]).test({
    status: 0,
  });
});

describe("show detailed usage with --help l (alias)", () => {
  runPrettier("cli", ["--help", "l"]).test({
    status: 0,
  });
});

describe("show detailed usage with plugin options (automatic resolution)", () => {
  runPrettier("plugins/automatic", [
    "--help",
    "tab-width",
    "--parser=bar",
    "--plugin-search-dir=.",
  ]).test({
    status: 0,
  });
});

describe("show detailed usage with plugin options (manual resolution)", () => {
  runPrettier("cli", [
    "--help",
    "tab-width",
    "--plugin=../plugins/automatic/node_modules/prettier-plugin-bar",
    "--parser=bar",
  ]).test({
    status: 0,
  });
});

describe("throw error with --help not-found", () => {
  runPrettier("cli", ["--help", "not-found"]).test({
    status: 1,
  });
});

describe("show warning with --help not-found (typo)", () => {
  runPrettier("cli", [
    "--help",
    // cspell:disable-next-line
    "parserr",
  ]).test({
    status: 0,
  });
});

describe("throw error with --check + --list-different", () => {
  runPrettier("cli", ["--check", "--list-different"]).test({
    status: 1,
  });
});

describe("throw error with --write + --debug-check", () => {
  runPrettier("cli", ["--write", "--debug-check"]).test({
    status: 1,
  });
});

describe("throw error with --find-config-path + multiple files", () => {
  runPrettier("cli", ["--find-config-path", "abc.js", "def.js"]).test({
    status: 1,
  });
});

describe("throw error with --file-info + multiple files", () => {
  runPrettier("cli", ["--file-info", "abc.js", "def.js"]).test({
    status: 1,
  });
});

describe("throw error and show usage with something unexpected", () => {
  runPrettier("cli", [], { isTTY: true }).test({
    status: "non-zero",
  });
});

test.skip("node version error", async () => {
  const originalProcessVersion = process.version;
  let result;

  Object.defineProperty(process, "version", {
    value: "v8.0.0",
    writable: false,
  });
  try {
    result = await runPrettier("cli", ["--help"]);
  } finally {
    Object.defineProperty(process, "version", {
      value: originalProcessVersion,
      writable: false,
    });
  }

  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    "prettier requires at least version 12.17.0 of Node, please upgrade\n"
  );
  expect(result.stdout).toBe("");
  expect(result.write).toEqual([]);
});
