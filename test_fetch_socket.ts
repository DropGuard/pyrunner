import { join } from "node:path";
import { homedir } from "node:os";
import { unlinkSync, existsSync } from "node:fs";

const socketPath = join(homedir(), ".pyrunner", "test_fetch.sock");
if (existsSync(socketPath)) unlinkSync(socketPath);

const server = Bun.serve({
  unix: socketPath,
  fetch(req) {
    return new Response("Hello from fetch test!");
  },
});

try {
  const res = await fetch("http://localhost/", {
    unix: socketPath,
  });
  const text = await res.text();
  console.log("Response:", text);
  server.stop();
  process.exit(0);
} catch (e) {
  console.error("Fetch failed:", e);
  server.stop();
  process.exit(1);
}
