/**
 * @module errors/promptErrors
 *
 * Typed errors raised by prompt resolution code paths. These let the central
 * error-handling middleware map specific failure modes to specific HTTP
 * responses rather than collapsing everything into a generic 500.
 */

/**
 * Thrown when a server-side resolver attempts to load a prompt whose runtime
 * is `'device'`. Such prompts are consumed by the mobile companion app's
 * on-device model (e.g. Gemma 3n E4B) and the server must never invoke a
 * model for them.
 *
 * If this error reaches the error handler it indicates a foot-gun: an admin
 * has flagged a prompt as device-only but a server code path is still trying
 * to resolve it. The fix is either (a) revert the prompt's runtime, or
 * (b) stop calling the device-only prompt from server code.
 */
export class PromptIsDeviceOnlyError extends Error {
  /** Slug or name of the prompt that triggered the guard. */
  public readonly promptKey: string;

  constructor(promptKey: string) {
    super(
      `Prompt "${promptKey}" has runtime='device' and cannot be invoked server-side. ` +
        `Either change its runtime to 'server' in the admin UI, or stop calling it from server code.`,
    );
    this.name = "PromptIsDeviceOnlyError";
    this.promptKey = promptKey;
  }
}
