import semver from "semver";
import { runGit, readJson, logPromise } from "./utils.js";
import parseArguments from "./parse-arguments.js";
import * as steps from "./steps/index.js";

const params = parseArguments();
const { stdout: previousVersion } = await runGit([
  "describe",
  "--tags",
  "--abbrev=0",
]);
if (semver.parse(previousVersion) === null) {
  throw new Error(`Unexpected previousVersion: ${previousVersion}`);
} else {
  params.previousVersion = previousVersion;
  params.previousVersionOnDefaultBranch = (
    await readJson("package.json")
  ).version;
}

for (let step of [
  {
    name: "Validating new version",
    process: steps.validateNewVersion,
  },
  {
    name: "Checking git status",
    process: steps.checkGitStatus,
    skip: params.dry,
  },
  {
    name: "Installing NPM dependencies",
    process: steps.installDependencies,
    skip: params.dry || params.skipDependenciesInstall || !params.manual,
  },
  {
    name: "Linting files",
    process: steps.lintFiles,
    skip: params.dry,
  },
  {
    name: "Bumping version",
    process: steps.updateVersion,
    skip: params.dry,
  },
  steps.generateBundles,
  steps.updateChangelog,
  {
    name: "Committing and pushing to remote",
    process: steps.pushToGit,
    skip: params.dry,
  },
  params.manual ? steps.publishToNpm : steps.waitForBotRelease,
  steps.showInstructionsAfterNpmPublish,
  steps.updateDependentsCount,
  steps.bumpPrettier,
  steps.postPublishSteps,
]) {
  if (typeof step === "function") {
    step = { process: step };
  }

  const runStep = () => step.process(params);

  if (step.name) {
    await logPromise(step.name, runStep, step.skip);
  } else if (!step.skip) {
    await runStep();
  }
}
