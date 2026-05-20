import { join } from "node:path";
import pino from "pino";
import pretty from "pino-pretty";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Initializes the global logger.
 * @param logDir If provided, daemon logs will be written to daemon.log in this directory.
 */
export function initLogger(logDir?: string) {
  const streams: pino.StreamEntry[] = [];

  // Always log to terminal in dev mode or if not in a daemon-like environment
  if (isDev || !logDir) {
    streams.push({
      stream: pretty({
        colorize: true,
        translateTime: "yyyy-mm-dd HH:MM:ss",
        ignore: "pid,hostname",
        customLevels: "success:35,info:30,warn:40,error:50,fatal:60",
        customColors: "success:green,info:cyan,warn:yellow,error:red,fatal:red",
      }) as any,
    });
  }

  // Log to file if logDir is provided (typical for Daemon)
  if (logDir) {
    streams.push({
      stream: pino.destination({
        dest: join(logDir, "daemon.log"),
        append: true,
        mkdir: true,
      }),
    });
  }

  const pinoInstance = pino(
    {
      level: process.env.LOG_LEVEL || "info",
      customLevels: {
        success: 35,
      },
    },
    pino.multistream(streams),
  );

  // Update the exported logger object's methods to use the new instance
  logger.info = (msg: string) => pinoInstance.info(msg);
  logger.warn = (msg: string) => pinoInstance.warn(msg);
  logger.error = (msg: string, err?: unknown) => {
    if (err) {
      pinoInstance.error({ err }, msg);
    } else {
      pinoInstance.error(msg);
    }
  };
  logger.success = (msg: string) => (pinoInstance as any).success(msg);

  return pinoInstance;
}

// Initial default logger (terminal only)
const defaultPino = pino(
  {
    level: "info",
    customLevels: { success: 35 },
  },
  pretty({
    colorize: true,
    translateTime: "yyyy-mm-dd HH:MM:ss",
    ignore: "pid,hostname",
    customLevels: "success:35,info:30,warn:40,error:50,fatal:60",
    customColors: "success:green,info:cyan,warn:yellow,error:red,fatal:red",
  }) as any,
);

export const logger = {
  info: (msg: string) => defaultPino.info(msg),
  warn: (msg: string) => defaultPino.warn(msg),
  error: (msg: string, err?: unknown) => {
    if (err) {
      defaultPino.error({ err }, msg);
    } else {
      defaultPino.error(msg);
    }
  },
  success: (msg: string) => (defaultPino as any).success(msg),
};
