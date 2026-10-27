export type StripeOperation = "/customers" | "/checkout/sessions";

// Accept exact documented values, never arbitrary provider strings or messages.
// https://docs.stripe.com/api/errors
// https://docs.stripe.com/error-codes
const errorTypes = new Set([
  "api_error",
  "card_error",
  "idempotency_error",
  "invalid_request_error",
]);
const errorCodes = new Set([
  "amount_too_large",
  "amount_too_small",
  "api_key_expired",
  "customer_tax_location_invalid",
  "email_invalid",
  "idempotency_key_in_use",
  "invalid_tax_location",
  "livemode_mismatch",
  "lock_timeout",
  "parameter_invalid_empty",
  "parameter_invalid_integer",
  "parameter_invalid_string_blank",
  "parameter_invalid_string_empty",
  "parameter_missing",
  "parameter_unknown",
  "parameters_exclusive",
  "postal_code_invalid",
  "rate_limit",
  "resource_missing",
  "secret_key_required",
  "taxes_calculation_failed",
  "url_invalid",
]);

type StripeFailureDiagnostic = {
  operation: StripeOperation;
  failure: "http" | "transport";
  status?: number;
  requestId?: string;
  errorType?: string;
  errorCode?: string;
};

export async function reportStripeFailure(
  operation: StripeOperation,
  response?: Response,
): Promise<void> {
  const diagnostic: StripeFailureDiagnostic = {
    operation,
    failure: response ? "http" : "transport",
  };
  if (response) {
    diagnostic.status = response.status;
    // Request-Id is response metadata; do not accept a body-supplied identifier.
    // https://docs.stripe.com/api/request_ids
    const requestIdentifier = response.headers.get("Request-Id");
    if (requestIdentifier && /^req_[A-Za-z0-9]{1,64}$/.test(requestIdentifier))
      diagnostic.requestId = requestIdentifier;
    try {
      const payload: unknown = await response.json();
      const providerError =
        payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
      if (providerError && typeof providerError === "object") {
        if (
          "type" in providerError &&
          typeof providerError.type === "string" &&
          errorTypes.has(providerError.type)
        )
          diagnostic.errorType = providerError.type;
        if (
          "code" in providerError &&
          typeof providerError.code === "string" &&
          errorCodes.has(providerError.code)
        )
          diagnostic.errorCode = providerError.code;
      }
    } catch {
      // Body read and parse exceptions may contain request data. Retain only
      // response metadata, and let the caller return its generic provider error.
    }
  }
  console.error("[Checkout] Stripe request failure:", diagnostic);
}
