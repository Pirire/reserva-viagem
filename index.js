<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Reservas</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #f0f4f8; font-family: sans-serif; }
    .reserva-card { background: white; border-radius: 1rem; padding: 1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap: 1rem; }
    .btn { padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: bold; cursor: pointer; }
    .btnMotorista { background-color: #4ade80; color: white; }
  </style>
</head>
<body class="p-4">
  <h1 class="text-2xl font-bold text-center mb-4">Administração de Reservas</h1>
  <div id="reservaContainer" class="grid-4"></div>

<script>
const backendURL = "https://reserva-backend-uu52.onrender.com";

// Função para buscar reservas
async function carregarReservas() {
  try {
    const username = prompt("Usuário admin:");
    const password = prompt("Senha admin:");
    if (!username || !password) return alert("Autenticação cancelada");

    const res = await fetch(`${backendURL}/reservas`, {
      headers: { "Authorization": "Basic " + btoa(`${username}:${password}`) }
    });

    if (!res.ok) {
      const err = await res.json();
      return alert("Erro: " + (err.error || "Não foi possível carregar reservas."));
    }

    const data = await res.json();
    const container = document.getElementById("reservaContainer");
    container.innerHTML = "";

    data.reservas.sort((a,b)=>new Date(a.datahora)-new Date(b.datahora));

    data.reservas.forEach(r => {
      const card = document.createElement("div");
      card.className = "reserva-card";
      card.innerHTML = `
        <p><strong>Nome:</strong> ${r.nome}</p>
        <p><strong>Email:</strong> ${r.email}</p>
        <p><strong>Categoria:</strong> ${r.categoria}</p>
        <p><strong>Partida:</strong> ${r.partida}</p>
        <p><strong>Destino:</strong> ${r.destino}</p>
        <p><strong>Data:</strong> ${new Date(r.datahora).toLocaleString()}</p>
        <p><strong>Valor:</strong> ${r.valor} €</p>
        <p><strong>Código:</strong> ${r.codigo}</p>
        <p><strong>Para Motorista:</strong> ${r.paraMotorista ? "✅" : "❌"}</p>
        <button class="btn btnMotorista" data-id="${r._id}" ${r.paraMotorista ? "disabled" : ""}>Enviar para Motorista</button>
      `;
      container.appendChild(card);
    });

    document.querySelectorAll(".btnMotorista").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          const resp = await fetch(`${backendURL}/reservas/${id}/motorista`, {
            method: "PATCH",
            headers: { 
              "Authorization": "Basic " + btoa(`${username}:${password}`),
              "Content-Type": "application/json"
            }
          });
          const result = await resp.json();
          if (resp.ok) {
            alert("Reserva marcada para motorista ✅");
            carregarReservas();
          } else alert(result.error);
        } catch(err) { console.error(err); alert("Erro ao atualizar reserva"); }
      });
    });

  } catch(err) {
    console.error(err);
    alert("Erro ao carregar reservas");
  }
}

carregarReservas();
</script>
</body>
</html>
