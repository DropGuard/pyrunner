import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { getBinaryName, getPlatformTarget } from "../src/utils/paths";

const rootDir = join(import.meta.dirname, "..");
const pkg = await Bun.file(join(rootDir, "package.json")).json();
const ALL_TARGETS = ["windows-x64", "linux-x64", "darwin-arm64", "darwin-x64"];

async function buildPlatform(target: string) {
  const [os, arch] = target.split("-");
  const binName = getBinaryName(os);
  const outDir = join(rootDir, "dist", "platforms", target);
  const outFile = join(outDir, binName);

  console.log(`📦 Building @dropguard/pyrunner-${target} v${pkg.version}...`);
  await $`mkdir -p ${outDir}`;
  // Using --production forces Bun to use the production JSX transform (jsx instead of jsxDEV),
  // matching the production React runtime bundled during --compile.
  await $`bun build --compile --minify --production --target=bun-${os}-${arch} ./src/cli/index.ts --outfile ${outFile}`.cwd(
    rootDir,
  );

  await Bun.write(
    join(outDir, "package.json"),
    JSON.stringify(
      {
        name: `@dropguard/pyrunner-${target}`,
        version: pkg.version,
        os: [os === "windows" ? "win32" : os],
        cpu: [arch === "arm64" ? "arm64" : "x64"],
        files: [binName],
        license: pkg.license,
      },
      null,
      2,
    ) + "\n",
  );

  // Link to local node_modules to enable unified binary resolution (Priority 2)
  const localNodeModuleDir = join(rootDir, "node_modules", "@dropguard", `pyrunner-${target}`);
  await mkdir(join(rootDir, "node_modules", "@dropguard"), { recursive: true });
  await rm(localNodeModuleDir, { recursive: true, force: true });
  await cp(outDir, localNodeModuleDir, { recursive: true });
  console.log(`🔗 Linked to local node_modules: ${localNodeModuleDir}`);
}

async function preparePublish() {
  console.log("📢 Preparing publish directory...");
  const outDir = join(rootDir, "dist", "publish");
  const publishPkg = {
    ...pkg,
    dependencies: undefined,
    devDependencies: undefined,
    optionalDependencies: Object.fromEntries(
      ALL_TARGETS.map((t) => [`@dropguard/pyrunner-${t}`, pkg.version]),
    ),
  };

  await $`mkdir -p ${outDir}`;
  await Bun.write(join(outDir, "package.json"), JSON.stringify(publishPkg, null, 2) + "\n");
  for (const f of ["bin.js", "README.md", "LICENSE"]) {
    await Bun.write(join(outDir, f), Bun.file(join(rootDir, f)));
  }
}

const [cmd, target] = process.argv.slice(2);
try {
  if (cmd === "all") {
    await $`rm -rf ${join(rootDir, "dist")}`;
    for (const t of ALL_TARGETS) await buildPlatform(t);
    await preparePublish();
  } else if (cmd === "publish") {
    await preparePublish();
  } else if (cmd === "platform") {
    if (!target) throw new Error("Missing target for platform command");
    await buildPlatform(target);
  } else {
    await buildPlatform(getPlatformTarget());
  }
} catch (e) {
  console.error(`❌ Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
