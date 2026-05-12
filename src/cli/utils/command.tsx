import { render } from "ink";
import { ErrorBox } from "../components/ErrorBox";

/**
 * Wraps a CLI command action with global error handling.
 * It catches any errors, renders them using the ErrorBox component, and exits the process.
 */
export function cliAction<T extends unknown[]>(fn: (...args: T) => Promise<void> | void) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      render(<ErrorBox error={err} />);
      process.exit(1);
    }
  };
}
