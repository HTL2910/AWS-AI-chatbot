/** Missing or invalid local configuration. Callers should offer Setup. */
export class ProviderConfigurationError extends Error {
  readonly name = "ProviderConfigurationError";

  constructor(message: string) {
    super(message);
  }
}

/** The endpoint was reached (or refused) and the user can act on the message. */
export class ProviderRequestError extends Error {
  readonly name = "ProviderRequestError";

  constructor(message: string) {
    super(message);
  }
}
