# PLANO DE MIGRAÇÃO — Unificar num só sistema de reservas

## Decisão tomada
**Fica o sistema NOVO:** `ShareTrip` / `ShareInvite` (Reserva Flexível / Evento).
**Morre o sistema ANTIGO:** modelo `Reserva` + `reserva.html` + `estou-pronto.html` (link antigo).

**Porquê:** o sistema novo é o único que já escreve no modelo `Trip` (coleção `viagens`),
que é a fonte de verdade única de todo o resto — painel de despacho do admin,
classificações, relatório SLA. O antigo (`Reserva`) vive à parte e fica desligado disso.
Uma fonte de verdade = escalável. Duas = o bug de hoje ("às vezes não encontra").

---

## O bug que estamos a resolver
- `rm-core.js` (hotel-dashboard) cria a reserva via `/partilha/reserva-simples/criar` → grava `ShareInvite` (NOVO)
- `reserva.html` (página standalone) cria via `/api/reservas/reserva` → grava `Reserva` (ANTIGO)
- O SMS "Estou Pronto" antigo aponta para `estou-pronto.html?codigo=RM-...`
- `estou-pronto.html` chama `/api/reservas/estou-pronto` → procura em `Reserva`
- **Resultado:** reserva criada num modelo, procurada no outro → "Reserva não encontrada"
- O SMS também parte porque os dois fluxos enviam SMS diferentes, com links diferentes.

---

## PASSOS (executar por esta ordem, testar a cada passo, commit no git a cada passo que funcione)

### Passo 0 — Confirmar a base de dados (ANTES de tudo)
Hoje mexeste na ligação ao Mongo (DNS, connection string). Confirmar que criação e leitura
falam com o MESMO cluster/base:
1. Criar uma reserva de teste, anotar o código
2. Ir ao Atlas (cloud.mongodb.com) → Browse Collections → ver se a reserva lá está
3. Confirmar que a connection string no `.env` aponta para o cluster certo
- Se a reserva não estiver na base que esperas → resolver isto PRIMEIRO, nada de migrar por cima.

### Passo 1 — Decidir o destino do `reserva.html`
Pergunta a responder: **o `reserva.html` (página standalone) ainda é usado por alguém?**
- Se NÃO (o hotel-dashboard.html já o substitui) → aposentar (mover para uma pasta `_arquivo/` ou apagar)
- Se SIM → migrar para o sistema novo (mesmo caminho que o rm-core.js já usa)

### Passo 2 — Um só "Estou Pronto"
Garantir que TODO o fluxo usa o "Estou Pronto" do sistema novo:
- Link no SMS → `hotel-dashboard.html?...&pronto=1` (ou uma página dedicada nova que chame o endpoint novo)
- Endpoint → `/partilha/evento/estou-pronto` (procura em `ShareInvite`) ✓
- Aposentar `estou-pronto.html` antigo (que chama `/reservas/estou-pronto` → `Reserva`)

### Passo 3 — Confirmar o envio de SMS no fluxo novo
- Verificar que `/partilha/reserva-simples/criar` envia o SMS com o link certo (novo)
- Testar: criar reserva → confirmar que o SMS chega com o link novo

### Passo 4 — Teste de ponta a ponta (o fluxo que funcionava antes)
Testar a cadeia completa, um passo de cada vez:
1. Criar reserva → recebe SMS? ✅/❌
2. Ativar viagem → motorista recebe pedido? ✅/❌
3. Motorista aceita → vai para as reservas? ✅/❌
4. Inicia recolha → utilizador vê cartão do motorista? ✅/❌
5. Localização em tempo real aparece? ✅/❌

### Passo 5 — Limpeza final
- Remover o modelo `Reserva` só DEPOIS de tudo acima funcionar (ou deixá-lo órfão, sem rotas a apontar-lhe)
- Limpar ficheiros lixo da raiz do projeto: `{`, `console.error('INIT`, `check2.mjs`–`check8.mjs`, `diag.txt`, etc.
- Melhorar o `.gitignore` para apanhar `public/uploads/` (documentos de utilizadores não devem ir para o git)

---

## Dúvida técnica separada (verificar durante os testes)
No `reservas.routes.js`, o `handlerMotoristaAtribuido` procura `trip.status === "assigned"` (inglês).
No `partilha.routes.js`, o `/evento/motorista-atribuido` aceita `["atribuida","em_viagem","aceite","confirmada"]` (português).
**Um dos dois está errado.** Ver o `dispatch.events.js` para confirmar QUAL o valor real que o
dispatch grava quando o motorista aceita, e alinhar ambos os handlers a esse valor.

---

## Regra de ouro para amanhã
- Git commit a CADA passo que funcione (`git add .` + `git commit -m "..."`)
- Testar cada passo ANTES de avançar para o seguinte
- Não mexer em pagamentos/despacho cansado
- Se um passo partir algo → `git checkout .` volta ao último estado bom

## Estado seguro atual (ponto de retorno)
Commit `6930f1f` — "Estado a funcionar - backend serve frontend, rm-events corrigido, DNS resolvido"
