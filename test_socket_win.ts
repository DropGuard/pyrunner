import { join } from "node:path";
import { homedir } from "node:os";
import { unlinkSync, existsSync } from "node:fs";

const socketPath = join(homedir(), ".pyrunner", "test.sock");
if (existsSync(socketPath)) unlinkSync(socketPath);

try {
  Bun.serve({
    unix: socketPath,
    fetch(req) {
      return new Response("Hello from socket!");
    },
  });
  console.log("Success! Listening on", socketPath);
  process.exit(0);
} catch (e) {
  console.error("Failed:", e);
  process.exit(1);
}
