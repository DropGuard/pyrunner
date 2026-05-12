import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm } from "node:fs/promises";
import { DaemonClient } from "../src/cli/client";

const TEST_DIR = join(tmpdir(), `pyrunner-test-${Date.now()}`);
process.env.PYRUNNER_DIR = TEST_DIR;

test("Client-Server Communication via Unix Socket", async () => {
  await mkdir(TEST_DIR, { recursive: true });
  const IPC_PATH = join(TEST_DIR, "daemon.sock");

  const daemonProcess = Bun.spawn(["bun", "src/cli/index.ts", "start"], {
    env: { ...process.env, PYRUNNER_DIR: TEST_DIR },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the IPC file to actually exist
  let socketExists = false;
  for (let i = 0; i < 50; i++) {
    const { existsSync } = await import("node:fs");
    if (existsSync(IPC_PATH)) {
      socketExists = true;
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

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
    const client = new DaemonClient();
    
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
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (!ready) {
      console.log("Daemon Output:\n", daemonOutput);
      console.log("Last Error:", lastError);
    }
    expect(ready).toBe(true);

    const status = await client.getDaemonStatus();
    expect(status.pid).toBeDefined();

    const jobs = await client.listJobs();
    expect(Array.isArray(jobs)).toBe(true);

    await client.shutdown();
    await daemonProcess.exited;
    expect(daemonProcess.exitCode).toBe(0);

  } finally {
    daemonProcess.kill();
    await rm(TEST_DIR, { recursive: true, force: true });
  }
}, 30000);
