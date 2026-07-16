// src/services/paypalClient.js
import paypal from "@paypal/checkout-server-sdk";

export function getPayPalEnv() {
  const env = String(process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "live" ? "live" : "sandbox";
}

export function paypalClient() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "");
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || "");

  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET não definidos no .env");
  }

  const environment =
    getPayPalEnv() === "live"
      ? new paypal.core.LiveEnvironment(clientId, clientSecret)
      : new paypal.core.SandboxEnvironment(clientId, clientSecret);

  return new paypal.core.PayPalHttpClient(environment);
}
