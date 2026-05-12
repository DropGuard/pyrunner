export const logger = {
  info: (msg: string) => console.log(`[\x1b[36m${new Date().toLocaleString()}\x1b[0m] ${msg}`),
  warn: (msg: string) =>
    console.warn(`[\x1b[33m${new Date().toLocaleString()}\x1b[0m] [WARN] ${msg}`),
  error: (msg: string, err?: unknown) => {
    console.error(`[\x1b[31m${new Date().toLocaleString()}\x1b[0m] [ERROR] ${msg}`, err ?? "");
  },
  success: (msg: string) =>
    console.log(`[\x1b[32m${new Date().toLocaleString()}\x1b[0m] [OK] ${msg}`),
};
