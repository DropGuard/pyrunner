import { expect, test, describe, afterAll } from "bun:test";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const JOB_NAME = "test_encoding_" + Date.now();
const SCRIPT_PATH = join(tmpdir(), `${JOB_NAME}.py`);
const TEST_DB = join(tmpdir(), `test_encoding_${Date.now()}.sqlite`);
// Use 'bun run' to test the source code directly in an integration-like manner
// This is cross-platform and doesn't require a pre-built binary.
const CLI_ENTRY = join(import.meta.dir, "..", "src", "cli.ts");
const LOG_PATH = join(process.env.USERPROFILE || process.env.HOME || "", ".pyrunner", "logs", `${JOB_NAME}.log`);

const POEM = `
春江潮水连海平，海上明月共潮生。
滟滟随波千万里，何处春江无月明？
...
斜月沉沉藏海雾，碣石潇湘无限路。
不知乘月几人归，落月摇情满江树。`;

const cleanup = () => {
  const targets = [SCRIPT_PATH, LOG_PATH, TEST_DB, `${TEST_DB}-shm`, `${TEST_DB}-wal`];
  for (const p of targets) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {}
  }
};

async function run(...args: string[]): Promise<{ stdout: string; exitCode: number }> {
  // Use bun to run the source code, simulating a real CLI call
  const proc = Bun.spawn(["bun", CLI_ENTRY, ...args], { 
    stdout: "pipe", 
    stderr: "pipe",
    env: {
      ...process.env,
      PYRUNNER_DB_PATH: TEST_DB,
      NODE_ENV: "production" // Force non-test mode behavior
    }
  });
  const exitCode = await proc.exited;
  return { stdout: await new Response(proc.stdout).text(), exitCode };
}

describe("Encoding Integration (Source-based)", () => {
  afterAll(cleanup);

  test("UTF-8 Pipeline Integrity", async () => {
    // 1. Create a Python script that outputs raw UTF-8 bytes
    writeFileSync(SCRIPT_PATH, [
      "import sys",
      "sys.stdout.buffer.write(\"\"\"" + POEM + "\"\"\".encode('utf-8'))",
    ].join("\n"));

    // 2. Add the job (Testing DB Persistence)
    const addRes = await run("add", JOB_NAME, SCRIPT_PATH, "* * * * *");
    expect(addRes.exitCode).toBe(0);
    
    // 3. Run the job (Testing Process Capture & Log Writing)
    const runRes = await run("run", JOB_NAME);
    expect(runRes.exitCode).toBe(0);

    // 4. Verify the log file on disk is valid UTF-8
    expect(existsSync(LOG_PATH)).toBe(true);
    const raw = readFileSync(LOG_PATH);
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(raw));
    } catch {
      throw new Error("Log file contains invalid UTF-8 bytes - the encoding pipeline is broken.");
    }

    // 5. Verify content integrity
    for (const line of POEM.split("\n")) {
      if (line.trim()) expect(decoded).toContain(line.trim());
    }

    // 6. Verify CLI 'logs' command output
    const logCmdRes = await run("logs", JOB_NAME);
    expect(logCmdRes.exitCode).toBe(0);
    for (const line of POEM.split("\n")) {
      if (line.trim()) expect(logCmdRes.stdout).toContain(line.trim());
    }

    // 7. Cleanup (Testing DB Removal)
    await run("remove", JOB_NAME);
  });
});
