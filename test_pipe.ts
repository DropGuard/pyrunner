const pipePath = "\\\\.\\pipe\\testpipe";
try {
  Bun.serve({
    unix: pipePath,
    fetch(req) {
      return new Response("Hello from pipe!");
    },
  });
  console.log("Success! Listening on", pipePath);
  process.exit(0);
} catch (e) {
  console.error("Failed:", e);
  process.exit(1);
}
