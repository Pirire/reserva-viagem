// 💳 PayPal - Criar ordem
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, valor } = req.body;

    const valorEuros = Number(valor).toFixed(2);
    if (isNaN(valorEuros) || valorEuros <= 0) {
      return res.status(400).json({ error: "Valor inválido." });
    }

    const orderRequest = new paypal.orders.OrdersCreateRequest();
    orderRequest.prefer("return=representation");
    orderRequest.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "EUR",
            value: valorEuros
          },
          description: `Reserva de viagem - ${categoria}`
        }
      ],
      application_context: {
        brand_name: "Reserva de Viagem",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: `${process.env.FRONTEND_URL}/sucesso`,
        cancel_url: `${process.env.FRONTEND_URL}/cancelado`
      }
    });

    const order = await client.execute(orderRequest);

    res.json({ orderID: order.result.id });
  } catch (err) {
    console.error("💥 Erro ao criar ordem PayPal:", err);
    res.status(500).json({ error: "Erro ao criar ordem PayPal", details: err.message });
  }
});

// 💳 PayPal - Capturar ordem
app.post("/capture-paypal-order/:orderID", async (req, res) => {
  try {
    const { orderID } = req.params;

    const captureRequest = new paypal.orders.OrdersCaptureRequest(orderID);
    captureRequest.requestBody({});

    const capture = await client.execute(captureRequest);

    // Aqui você pode salvar no MongoDB se quiser
    console.log("✅ Pagamento capturado:", capture.result);

    res.json({ success: true, details: capture.result });
  } catch (err) {
    console.error("💥 Erro ao capturar pagamento PayPal:", err);
    res.status(500).json({ error: "Erro ao capturar pagamento", details: err.message });
  }
});
