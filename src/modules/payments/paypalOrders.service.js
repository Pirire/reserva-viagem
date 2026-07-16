// src/services/paypalOrders.service.js
import paypal from "@paypal/checkout-server-sdk";
import { paypalClient } from "./paypalClient.js";

function findLink(result, rel) {
  const links = result?.links || [];
  return links.find((l) => l.rel === rel)?.href || null;
}

export async function createOrder({ amountEUR, customId, returnUrl, cancelUrl }) {
  const client = paypalClient();

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "EUR",
          value: Number(amountEUR).toFixed(2),
        },
        custom_id: String(customId || ""),
      },
    ],
    application_context: {
      brand_name: "Reserva",
      landing_page: "LOGIN",
      user_action: "PAY_NOW",
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });

  const response = await client.execute(request);
  const approveUrl = findLink(response?.result, "approve");

  return {
    orderId: response?.result?.id,
    approveUrl,
    raw: response?.result,
  };
}

export async function captureOrder(orderId) {
  const client = paypalClient();
  const request = new paypal.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});

  const response = await client.execute(request);
  return response?.result;
}
