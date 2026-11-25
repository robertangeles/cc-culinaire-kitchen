import type { Logger } from "pino";

/**
 * Last line of logging for an error nothing else caught. A rejection is logged and the server carries on;
 * after an uncaught exception its state is unknown, so it is logged and the server shuts down with an error code.
 */
export function handleProcessErrors(log: Logger, shutdown: (reason: string, exitCode: number) => void): void {
  process.on("unhandledRejection", (err) => {
    log.error({ err }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (err, origin) => {
    log.fatal({ err, origin }, "Uncaught exception");
    shutdown("uncaughtException", 1);
  });
}
