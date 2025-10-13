// ✅ Stripe - valor corrigido
app.post("/checkout", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, valor } = req.body;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Reserva de viagem - ${categoria}`
          },
          unit_amount: Math.round(parseFloat(valor)), // ✅ valor já em cêntimos
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/sucesso`,
      cancel_url: `${process.env.FRONTEND_URL}/cancelado`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar sessão Stripe" });
  }
});
