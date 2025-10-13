document.getElementById("confirmarPagamento").addEventListener("click", async () => {
  const nome = document.getElementById('nome').value;
  const email = document.getElementById('email').value;
  const categoria = categoriaSelecionada;
  const partida = document.getElementById('partida').value;
  const destino = document.getElementById('destino').value;
  const datahora = document.getElementById('datahora').value;

  // ❌ ultimoCusto é "13.67"
  // ✅ Convertemos para centavos inteiros para Stripe
  const valorCentavos = Math.round(parseFloat(ultimoCusto.replace(',', '.')) * 100);

  try {
    const res = await fetch(`${backendURL}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome,
        email,
        categoria,
        partida,
        destino,
        datahora,
        valor: valorCentavos
      }),
    });

    const session = await res.json();
    if (session.url) {
      window.location.href = session.url;
    } else {
      document.getElementById('popupStatus').textContent = "Erro ao iniciar pagamento.";
    }
  } catch (err) {
    console.error(err);
    document.getElementById('popupStatus').textContent = "Erro ao conectar com o backend.";
  }
});
