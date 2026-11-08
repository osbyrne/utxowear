import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { unstable_readConfig } from "wrangler";

export type DeploymentEnvironment = "preview" | "production";

function git(directory: string, ...arguments_: string[]): string {
  const result = Bun.spawnSync(["git", ...arguments_], { cwd: directory, stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Git command failed: git ${arguments_.join(" ")}`);
  return result.stdout.toString().trim();
}

export function verifyDeploymentReference(
  environment: DeploymentEnvironment,
  reference: string,
  directory = process.cwd(),
): { commit: string; version: string } {
  if (
    environment === "preview"
      ? reference !== "refs/heads/trunk"
      : !/^refs\/tags\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(reference)
  ) {
    throw new Error("Preview requires trunk; production requires a vX.Y.Z release tag.");
  }
  const commit = git(directory, "rev-parse", "HEAD");
  if (commit !== git(directory, "rev-parse", "--verify", `${reference}^{commit}`))
    throw new Error("The deployment reference does not identify the current commit.");
  if (environment === "production") {
    git(directory, "merge-base", "--is-ancestor", commit, "refs/remotes/origin/trunk");
  }
  if (git(directory, "status", "--porcelain"))
    throw new Error("Deployments require a clean working directory.");
  return {
    commit,
    version: environment === "production" ? reference.slice(10) : `trunk-${commit.slice(0, 12)}`,
  };
}

const deploymentConfiguration = Schema.Struct({
  name: Schema.String,
  workers_dev: Schema.Literal(false),
  preview_urls: Schema.Literal(false),
  vars: Schema.Record({ key: Schema.String, value: Schema.String }),
  routes: Schema.Array(
    Schema.Struct({ pattern: Schema.String, custom_domain: Schema.Literal(true) }),
  ),
  d1_databases: Schema.Array(Schema.Struct({ binding: Schema.String, database_id: Schema.String })),
  kv_namespaces: Schema.Array(Schema.Struct({ binding: Schema.String, id: Schema.String })),
});

export function verifyDeploymentArtifact(
  environment: DeploymentEnvironment,
  artifact: unknown,
): void {
  const decode = Schema.decodeUnknownSync(deploymentConfiguration);
  const expected = decode(unstable_readConfig({ config: "wrangler.jsonc", env: environment }));
  const actual = decode(artifact);
  const other = decode(
    unstable_readConfig({
      config: "wrangler.jsonc",
      env: environment === "preview" ? "production" : "preview",
    }),
  );
  if (expected.vars.FULFILLMENT_MODE !== (environment === "preview" ? "simulate" : "production"))
    throw new Error("The fulfillment mode does not match the deployment environment.");
  if (
    expected.d1_databases.some((database) =>
      other.d1_databases.some(
        (otherDatabase) => database.database_id === otherDatabase.database_id,
      ),
    ) ||
    expected.kv_namespaces.some((namespace) =>
      other.kv_namespaces.some((otherNamespace) => namespace.id === otherNamespace.id),
    )
  ) {
    throw new Error("Preview and production must use separate D1 and KV resources.");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("The build configuration does not match the deployment environment.");
}

async function deploy(): Promise<void> {
  const environment = process.argv[2];
  if (environment !== "preview" && environment !== "production")
    throw new Error("Specify a deployment environment: preview or production.");
  if (environment === "production") {
    const result = Bun.spawnSync([
      "git",
      "fetch",
      "origin",
      "+refs/heads/trunk:refs/remotes/origin/trunk",
    ]);
    if (result.exitCode !== 0) throw new Error("Cannot verify the current origin/trunk.");
  }
  const reference =
    process.env.GITHUB_REF ||
    (environment === "production"
      ? `refs/tags/${git(process.cwd(), "describe", "--exact-match", "--tags", "HEAD")}`
      : git(process.cwd(), "symbolic-ref", "HEAD"));
  const { commit, version } = verifyDeploymentReference(environment, reference);
  const childEnvironment = {
    ...process.env,
    CLOUDFLARE_ENV: environment,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  };
  async function run(
    arguments_: string[],
    environmentVariables: NodeJS.ProcessEnv = childEnvironment,
  ): Promise<void> {
    const result = Bun.spawn(arguments_, {
      env: environmentVariables,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await result.exited) !== 0) throw new Error(`Command failed: ${arguments_.join(" ")}`);
  }
  await run(["bun", "run", "build"]);
  const artifact: unknown = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
  verifyDeploymentArtifact(environment, artifact);
  await run(["bun", "run", `migrate:${environment}`]);
  const deploymentEnvironment: NodeJS.ProcessEnv = { ...childEnvironment };
  // Astro already resolved the named environment into this generated configuration.
  delete deploymentEnvironment.CLOUDFLARE_ENV;
  await run(
    [
      "bunx",
      "wrangler",
      "deploy",
      "--config",
      "dist/server/wrangler.json",
      "--tag",
      version,
      "--message",
      `Commit ${commit}`,
    ],
    deploymentEnvironment,
  );
}

if (import.meta.main) {
  deploy().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Deployment failed.");
    process.exitCode = 1;
  });
}
