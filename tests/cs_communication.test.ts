import { expect, test } from "bun:test";
import { $ } from "bun";

const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
const TEST_DIR = join(tmpDir, `pyrunner-test-${Date.now()}`);
process.env.PYRUNNER_DIR = TEST_DIR;

test("Client-Server Communication via Unix Socket", async () => {
  await $`mkdir -p ${TEST_DIR}`;

  // Dynamic import after env var is set
  const { DaemonClient } = await import("../src/cli/client");
  const { Config } = await import("../src/shared/config");
  const config = new Config();

  const daemonProcess = Bun.spawn(["bun", "src/cli/index.ts", "start"], {
    env: { ...process.env, PYRUNNER_DIR: TEST_DIR, NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });

  let daemonOutput = "";
  (async () => {
    const reader = daemonProcess.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      daemonOutput += new TextDecoder().decode(value);
    }
  })();

  try {
    const client = new DaemonClient(config);

    let ready = false;
    let lastError = "";
    for (let i = 0; i < 50; i++) {
      try {
        const health = await client.health();
        if (health.status === "ok") {
          ready = true;
          break;
        }
      } catch (e: any) {
        lastError = e.message;
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!ready) {
      console.log("Daemon Startup Failed");
      console.log("Daemon Output:\n", daemonOutput);
      console.log("Last Error:", lastError);
      throw new Error(`Daemon not ready: ${lastError}`);
    }

    const status = await client.getDaemonStatus();
    expect(status.pid).toBeDefined();

    const jobs = await client.listJobs();
    expect(Array.isArray(jobs)).toBe(true);

    await client.shutdown();
    await daemonProcess.exited;
    expect(daemonProcess.exitCode).toBe(0);
  } catch (e: any) {
    console.log("Test Failure Output:");
    console.log("Daemon Output:\n", daemonOutput);
    throw e;
  } finally {
    daemonProcess.kill();
    await $`rm -rf ${TEST_DIR}`;
  }
}, 30000);
