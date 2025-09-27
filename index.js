<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reserva</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyBJ6XoeSWUFGWFwPPgOQXZA1zfGpy1ECTg&libraries=places"></script>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    body {
      background-image: url('reserva-viagem/imagem-fundo.jpg');
      background-size: cover;
      background-position: center;
    }
    .input { width: 100%; min-height: 2.5rem; padding: 0.5rem; border: 1px solid #D1D5DB; border-radius: 0.75rem; box-sizing: border-box; }
    .linha-horizontal { display: flex; gap: 0.5rem; }
    #contato, #codigoReservaInd { flex: 1; }
    #partida, #destino, #datahora, #nome { width: 100%; min-height: 2.5rem; }
  </style>
</head>
<body class="bg-gray-100 flex items-center justify-center min-h-screen">

  <div id="conteudoPrincipal" class="bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-md w-full max-w-lg space-y-2 relative">

    <!-- GOOGLE TRANSLATE WIDGET -->
    <div class="absolute -top-2 right-4 transform scale-75">
      <div id="google_translate_element"></div>
    </div>

    <h1 class="text-2xl font-extrabold text-center text-green-600 mb-4">Reservar Viagem</h1>

    <h2 class="text-xl font-bold mb-2 text-center">SELECIONE A CATEGORIA</h2>
    <div id="categoria" class="grid grid-cols-2 gap-2 border p-2 rounded-xl">
      <button data-preco="0.55" data-nome="Confort" class="btn-cat uppercase">Confort</button>
      <button data-preco="0.75" data-nome="Premium" class="btn-cat uppercase">Premium</button>
      <button data-preco="1.00" data-nome="XL 7" class="btn-cat uppercase">XL 7</button>
      <button data-preco="0.70" data-nome="Passeio" class="btn-cat uppercase">Passeio</button>
    </div>

    <label for="partida" class="font-bold text-gray-700 mt-2">Local de Partida</label>
    <div class="flex items-center gap-2">
      <input id="partida" type="text" class="input flex-1 campoObrigatorio">
      <button id="btnLocalizacao" type="button" class="p-2 bg-green-500 text-white rounded-xl hover:bg-green-600">📍</button>
    </div>

    <label for="destino" class="font-bold text-gray-700 mt-2">Local de Destino</label>
    <input id="destino" type="text" class="input campoObrigatorio">

    <div class="grid grid-cols-2 gap-2 mt-2">
      <div>
        <label for="datahora" class="font-bold text-gray-700">Selecione Data e Hora</label>
        <input id="datahora" type="datetime-local" class="input campoObrigatorio">
      </div>
      <div>
        <label for="nome" class="font-bold text-gray-700">Nome de Utilizador</label>
        <input id="nome" type="text" class="input campoObrigatorio">
      </div>
    </div>

    <div class="linha-horizontal mt-2">
      <div class="flex-1">
        <label for="contato" class="font-bold text-gray-700">Nº de Contato</label>
        <input id="contato" type="text" class="input campoObrigatorio">
      </div>
      <div class="flex-1">
        <label for="codigoReservaInd" class="font-bold text-gray-700">Nº Indicação/Reserva</label>
        <input id="codigoReservaInd" type="text" class="input">
      </div>
    </div>

    <!-- Google Maps -->
    <div id="map" class="w-full h-64 mt-4 rounded-xl"></div>

    <!-- Info de distância, tempo e valor -->
    <div id="infoViagem" class="text-center font-bold mt-2"></div>

    <!-- Botões -->
    <div class="grid grid-cols-2 gap-2 mt-4">
      <button id="OK" disabled class="mt-3 w-full py-2 rounded-2xl bg-gray-400 text-white font-bold">OK</button>
      <button id="btn-cancelar" disabled class="mt-3 w-full py-2 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold">Cancelar Reserva</button>
    </div>
  </div>

  <!-- Pop-up resumo -->
  <div id="popupResumo" class="fixed inset-0 bg-black/60 flex items-center justify-center hidden">
    <div class="bg-white rounded-2xl p-6 w-96 shadow-lg space-y-4">
      <h2 class="text-xl font-bold text-green-700 text-center">Resumo da Viagem</h2>
      <p><strong>Nome:</strong> <span id="resNome"></span></p>
      <p><strong>Categoria:</strong> <span id="resCategoria"></span></p>
      <p><strong>Partida:</strong> <a id="resPartida" href="#" target="_blank" class="text-blue-600 underline"></a></p>
      <p><strong>Destino:</strong> <a id="resDestino" href="#" target="_blank" class="text-blue-600 underline"></a></p>
      <p><strong>Data:</strong> <span id="resData"></span></p>
      <p><strong>Contato:</strong> <span id="resContato"></span></p>
      <p><strong>Valor da Viagem:</strong> <span id="resValor" class="font-bold text-green-700"></span></p>
      <p><strong>Código de Reserva/Indicação:</strong> <span id="resCodigo"></span></p>
      <button id="confirmarPagamento" class="w-full py-2 rounded-2xl bg-purple-500 hover:bg-purple-600 text-white font-bold">EFETUAR PAGAMENTO</button>
    </div>
  </div>

  <!-- Pop-up Cancelar -->
  <div id="popupCancelar" class="fixed inset-0 bg-black/60 flex items-center justify-center hidden">
    <div class="bg-white rounded-2xl p-6 w-96 shadow-lg space-y-4">
      <h2 class="text-xl font-bold text-red-600 text-center">ATENÇÃO!</h2>
      <p>O CANCELAMENTO EFETUADO 4Hs PARA O INICIO DA VIAGEM FICA ISENTO DA TAXA DE CANCELAMENTO</p>
      <div class="grid grid-cols-2 gap-2 mt-4">
        <button id="simCancelar" class="py-2 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold">SIM!, CANCELAR</button>
        <button id="continuarReserva" class="py-2 rounded-2xl bg-green-500 hover:bg-green-600 text-white font-bold">CONTINUAR COM A RESERVA</button>
      </div>
    </div>
  </div>

  <script>
    const backendURL = "https://reserva-backend-uu52.onrender.com";
    const stripe = Stripe("pk_test_XXXXXXXXXXXXXXXXXXXX"); // coloque sua chave pública Stripe

    const btns = document.querySelectorAll('.btn-cat');
    let precoCategoria = 0, categoriaSelecionada = "", ultimoCusto = 0, ultimaDistancia = 0, ultimoTempo = "";
    let codigoReservaAtual = "";
    let partidaPlace = null, destinoPlace = null;

    btns.forEach(btn => {
      btn.className = "btn-cat w-full py-2 rounded-2xl bg-green-300 hover:bg-green-400 uppercase";
      btn.addEventListener('click', () => {
        btns.forEach(b => { b.classList.remove('bg-green-600'); b.classList.add('bg-green-300'); });
        btn.classList.remove('bg-green-300'); btn.classList.add('bg-green-600');
        precoCategoria = parseFloat(btn.getAttribute("data-preco"));
        categoriaSelecionada = btn.getAttribute("data-nome");
        validarFormulario(); calcularRotaDebounced();
      });
    });

    const camposObrig = document.querySelectorAll('.campoObrigatorio');
    camposObrig.forEach(c => c.addEventListener('input', () => validarFormulario()));

    function validarFormulario() {
      const preenchido = Array.from(camposObrig).every(c => c.value.trim() !== "") && categoriaSelecionada;
      document.getElementById("OK").disabled = !preenchido;
      document.getElementById("btn-cancelar").disabled = !preenchido;
    }

    document.getElementById("OK").addEventListener("click", () => {
      document.getElementById("resNome").textContent = document.getElementById("nome").value;
      document.getElementById("resCategoria").textContent = categoriaSelecionada;
      document.getElementById("resPartida").textContent = document.getElementById("partida").value;
      document.getElementById("resPartida").href = `https://www.google.com/maps/search/${encodeURIComponent(document.getElementById("partida").value)}`;
      document.getElementById("resDestino").textContent = document.getElementById("destino").value;
      document.getElementById("resDestino").href = `https://www.google.com/maps/search/${encodeURIComponent(document.getElementById("destino").value)}`;
      document.getElementById("resData").textContent = document.getElementById("datahora").value;
      document.getElementById("resContato").textContent = document.getElementById("contato").value;
      document.getElementById("resValor").textContent = `${ultimoCusto.toFixed(2)} €`;
      document.getElementById("resCodigo").textContent = codigoReservaAtual;
      document.getElementById("popupResumo").classList.remove('hidden');
    });

    document.getElementById("btn-cancelar").addEventListener("click", () => {
      document.getElementById("popupCancelar").classList.remove('hidden');
    });
    document.getElementById("continuarReserva").addEventListener("click", () => {
      document.getElementById("popupCancelar").classList.add('hidden');
    });

    document.getElementById("simCancelar").addEventListener("click", () => {
      alert("Reserva cancelada com sucesso!");
      document.getElementById("popupCancelar").classList.add('hidden');
    });

    document.getElementById("confirmarPagamento").addEventListener("click", async () => {
      const nome = document.getElementById("nome").value;
      const email = prompt("Digite seu e-mail para pagamento:");
      const valor = parseFloat(ultimoCusto);

      if (!nome || !email || !valor) {
        alert("Preencha todos os campos e selecione a categoria.");
        return;
      }

      try {
        const response = await fetch(`${backendURL}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome, email, valor })
        });
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          alert("FALHA NO PAGAMENTO!");
        }
      } catch (err) {
        console.error(err);
        alert("FALHA NO PAGAMENTO!");
      }
    });
  </script>
</body>
</html>
