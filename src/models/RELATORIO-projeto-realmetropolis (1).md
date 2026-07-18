# RELATÓRIO DO PROJETO — Realmetropolis (backend reserva-viagem)

> **Para que serve este ficheiro:** mostra-o no início de uma nova conversa
> para retomar o trabalho sem ter de explicar tudo de novo. Contém o estado
> atual, o que já foi feito, o que falta, e o plano.

---

## 1. O QUE É O PROJETO

Sistema de reservas de viagem/transporte para hotéis (Realmetropolis).
- **Backend:** Node.js + Express + MongoDB (Mongoose), servido também o frontend.
- **Estrutura:** hoje o backend serve o frontend (Express). Código do servidor em `src/`,
  ficheiros do frontend em `public/`. (Antes eram frontend e backend separados — foi
  unificado.)
- **Base de dados:** MongoDB Atlas — cluster `cluster0.jzjfit8`, base `reservaDB`. UMA só base.
- **Integrações:** Twilio (SMS), Stripe + PayPal (pagamento), Easypay/MB Way, Google Maps,
  SMTP (email), OSRM (rotas).
- **Repositório GitHub:** https://github.com/Pirire/reserva-viagem
- **Deploy:** Render (nuvem).

### Ficheiros principais do frontend (em public/js/)
- `rm-core.js` — núcleo, função `reservarViagem()` (cria reservas)
- `rm-events.js` — bindEvents, init, modo Evento/Reserva Flexível
- `rm-share.js` — partilha de viagem
- `rm-sla.js` — relatório SLA (mapa Google, gráfico, PDF, email)
- `rm-convidado.js` — fluxo de convidado
- Dashboard principal: `public/hotel-dashboard.html`

### Rotas backend principais (em src/)
- `reservas.routes.js` — sistema ANTIGO (modelo `Reserva`)
- `partilha.routes.js` — sistema NOVO (`ShareTrip`/`ShareInvite`, modo Evento)

---

## 2. O QUE FOI FEITO NESTA SESSÃO (resolvido ✅)

### 2.1 Crash do servidor no arranque (MongoDB) — RESOLVIDO
- **Sintoma:** `FATAL: Erro crítico no servidor` / `MongooseServerSelectionError` /
  `ReplicaSetNoPrimary`, servidor não arrancava.
- **Causa:** a operadora móvel (hotspot do telemóvel) bloqueava a resolução DNS dos
  registos SRV do MongoDB Atlas. Confirmado com `nslookup` (dava "Non-existent domain").
- **Solução:** mudar o DNS do Windows para o da Google — **8.8.8.8** e **8.8.4.4**
  (em ncpa.cpl → Propriedades da ligação → TCP/IPv4 → "Utilizar os seguintes DNS").
  Depois `ipconfig /flushdns`. Passou a resolver e o servidor arrancou.
- **NOTA futura:** se o servidor voltar a não ligar ao Mongo noutra rede, é este DNS.
  O 8.8.8.8 pode ficar fixo em qualquer rede.

### 2.2 Página e botões partidos (bug _slaMap) — RESOLVIDO
- **Sintoma:** `Uncaught SyntaxError: Identifier '_slaMap' has already been declared`
  seguido de `init is not defined`. O botão "Convidar mais pessoas" (e outros) não
  respondiam.
- **Causa:** o Relatório SLA estava DUPLICADO em dois ficheiros — `rm-sla.js` (versão
  Google Maps, mais completa) E `rm-events.js` (versão Leaflet, duplicada). Ambos
  declaravam `let _slaMap` no mesmo scope global → colisão → `rm-events.js` era rejeitado
  inteiro → a função `init` (que vive nele) nunca corria → botões mortos.
- **Solução:** removida a secção SLA duplicada do `rm-events.js` (linhas ~913–1112),
  mantendo o `rm-sla.js` como única versão. Ficheiro corrigido validado (parse OK) e
  aplicado. A chamada `abrirSLA()` do menu continua a funcionar (usa a do rm-sla.js).

### 2.3 Git / cópia de segurança — MONTADO
- Repositório git já existia mas estava dessincronizado (projeto reorganizado por baixo).
- Criado `.gitignore` (protege `.env`, `node_modules/`, logs, ficheiros de teste).
- Confirmado que o `.env` NÃO vai para o git (`git check-ignore .env` → `.env`).
- Primeiro commit limpo do estado a funcionar: **commit `6930f1f`**
  ("Estado a funcionar - backend serve frontend, rm-events corrigido, DNS resolvido").
- GitHub tinha uma versão antiga de 9 meses (commit `ac354e7`). Substituída com
  `git push --force` — o utilizador confirmou que NÃO queria nada do GitHub antigo.
- Backup do `.env` real feito em `..\env-backup-realmetropolis.txt` (no Ambiente de
  Trabalho, fora do projeto, sincronizado pelo OneDrive).
- Criado `env.example` (mapa das variáveis SEM segredos) e enviado para o git
  (commit `2b7a16d`). GitHub agora sincronizado com o projeto atual.

### 2.4 Passo 0 da migração — CONFIRMADO
- Usado o script `scripts/limparViagensTeste.js` (tem modo dry-run seguro sem `--confirmar`).
- Confirmado: só existe UMA base de dados (`reservaDB`).
- Confirmado: uma reserva de teste criada no `hotel-dashboard.html` aterrou na coleção
  **`reservas`** (sistema ANTIGO), e `sharetrips`/`shareinvites` ficaram a zero.
- Base de dados foi limpa durante os testes (coleções a zero) — terreno limpo para testar.

---

## 3. PROBLEMAS AINDA EM ABERTO (por resolver ❌)

### 3.1 SMS deixou de ser recebido
- **Contexto:** o SMS funcionou o dia todo (100+ testes, conta Twilio PAGA, não trial).
  Parou EXATAMENTE quando se fez a modificação de "5 botões para 2" (consolidação).
- **Pista do log:** o Twilio devolve `STATUS: accepted` e `FROM: null` (envio via
  `messagingServiceSid`). `accepted` ≠ `delivered` — pode morrer depois.
- **Suspeita principal:** ligada à consolidação de sistemas (ver 3.3). O fluxo de envio
  de SMS pode ter-se partido ou passado a usar um caminho diferente.
- **A verificar:** no painel Twilio (Monitor → Logs → Messaging), procurar o SID de um
  envio e ver o estado FINAL (delivered / undelivered / failed + error code).

### 3.2 "Estou Pronto" diz "Reserva não encontrada"
- **Sintoma:** ao clicar "Estou Pronto" (via link no SMS → `estou-pronto.html?codigo=RM-...`),
  responde "Reserva não encontrada".
- **Diagnóstico feito:** o `estou-pronto.html` chama `/api/reservas/estou-pronto`
  (correto), que procura no modelo `Reserva`. O handler está CORRETO. O `estou-pronto.html`
  está CORRETO. O problema é ONDE a reserva vive vs onde é procurada.
- **Causa raiz:** DOIS sistemas a coexistir (ver 3.3). A reserva pode ser criada num
  modelo e procurada no outro.

### 3.3 CAUSA RAIZ COMUM — dois sistemas de reserva a coexistir
Este é o problema de fundo que causa 3.1 e 3.2. A consolidação de "5 botões para 2"
ficou A MEIO:
- **Sistema ANTIGO:** `reserva.html` → `/api/reservas/reserva` → modelo `Reserva` →
  SMS com link `estou-pronto.html` → `/reservas/estou-pronto` (procura em `Reserva`).
- **Sistema NOVO:** `hotel-dashboard.html` (rm-core.js `reservarViagem`) →
  `/partilha/reserva-simples/criar` → `ShareTrip`/`ShareInvite` → `/evento/estou-pronto`
  (procura em `ShareInvite`).
- Os dois enviam SMS diferentes, com links diferentes, que procuram em modelos diferentes.
  Dependendo de qual "porta" a reserva entrou, o "Estou Pronto" encontra-a ou não.
- **NOTA:** no teste do Passo 0, a reserva do hotel-dashboard aterrou em `reservas`
  (antigo), o que sugere que o caminho testado ainda usa o antigo — a confirmar na
  próxima sessão qual botão/página usa qual sistema.

### 3.4 Dúvida técnica sobre atribuição de motorista
- `reservas.routes.js` → `handlerMotoristaAtribuido` procura `trip.status === "assigned"` (inglês).
- `partilha.routes.js` → `/evento/motorista-atribuido` aceita
  `["atribuida","em_viagem","aceite","confirmada"]` (português).
- UM dos dois está errado. Ver `dispatch.events.js` para saber que valor o dispatch
  grava realmente quando o motorista aceita, e alinhar ambos.

---

## 4. DECISÃO DE ARQUITETURA JÁ TOMADA

**Fica o sistema NOVO (`ShareTrip`/`ShareInvite`). Aposenta-se o ANTIGO
(`Reserva` + `reserva.html` + `estou-pronto.html`).**

Porquê: o sistema novo é o único que escreve no modelo `Trip` (coleção `viagens`), que é
a fonte de verdade única do resto do sistema (painel admin, classificações, SLA). Uma
fonte de verdade = escalável. Dois sistemas em paralelo = o bug atual.

---

## 5. PLANO PARA A PRÓXIMA SESSÃO (migração — Passo 1 em diante)

Regra de ouro: **testar cada passo antes de avançar; git commit a cada passo que funcione;
se partir, `git checkout .` volta ao último estado bom. NÃO mexer em pagamentos/despacho cansado.**

1. **Matar o fantasma da cache do botão:** subir `?v=9` → `?v=10` nos scripts do
   `hotel-dashboard.html` (o botão "Convidar mais pessoas" tem cache intermitente;
   Ctrl+Shift+R resolve temporariamente).

2. **Confirmar que botão/página usa que sistema:** verificar se o `hotel-dashboard.html`
   cria em `reservas` (antigo) ou `shareinvites` (novo) — no Passo 0 aterrou em `reservas`,
   contradizendo o que o código do rm-core.js sugeria. Esclarecer isto primeiro.

3. **Decidir destino do `reserva.html`:** ainda é usado, ou pode ser aposentado?
   (o hotel-dashboard.html substitui-o?).

4. **Unificar o "Estou Pronto":** um só link, um só endpoint, um só modelo.

5. **Confirmar envio de SMS no fluxo escolhido** e testar de ponta a ponta:
   criar → SMS → pagar → estou pronto → motorista atribuído → cartão do motorista →
   localização em tempo real.

6. **Alinhar o estado da atribuição** (ver 3.4) usando o valor real do `dispatch.events.js`.

7. **Limpeza final:** remover ficheiros lixo da raiz (`{`, `console.error('INIT`,
   `check2.mjs`–`check8.mjs`, `diag.txt`, `_out.txt`, `serverlog.txt`, `cookie.txt`);
   melhorar `.gitignore` para apanhar `public/uploads/` (documentos de utilizadores não
   devem ir para o git).

---

## 6. OBJETIVO DE LONGO PRAZO (declarado pelo utilizador)
"Escalável e profissional." Caminho, por ordem, DEPOIS de estabilizar e consolidar:
- Rede de segurança: ESLint com regra `no-redeclare`/`no-undef` + `node --check` antes de
  subir código (teria apanhado o bug do `_slaMap` antes de chegar ao browser).
- Migração dos scripts globais para módulos ES (`import`/`export`) — elimina de vez as
  colisões de variáveis globais como a do `_slaMap`.
- Eventual bundler (Vite/esbuild) e versionamento automático de assets (adeus `?v=` à mão).

---

## 7. ESTADO SEGURO ATUAL (pontos de retorno)
- **git local:** commit `2b7a16d` (env.example) sobre `6930f1f` (estado a funcionar).
- **GitHub:** sincronizado (https://github.com/Pirire/reserva-viagem).
- **Backup do .env:** `..\env-backup-realmetropolis.txt` (Ambiente de Trabalho / OneDrive).
- Servidor arranca, página funciona, botões funcionam (com Ctrl+Shift+R para a cache).

---

## 8. AMBIENTE / NOTAS PRÁTICAS
- Pasta do projeto: `C:\Users\silva\OneDrive\Ambiente de Trabalho\backend`
- Correr o servidor: `npm run dev` (nodemon)
- Windows em português: DNS em `ncpa.cpl`; Ambiente de Trabalho está dentro do OneDrive.
- Cache do browser é responsável por "deixou de funcionar sem razão" → Ctrl+Shift+R.
- Twilio configurado e pago (não trial). Mongo, Stripe, PayPal, Easypay/MB Way configurados.

---

## 9. ATUALIZAÇÃO — SESSÃO 2 (madrugada seguinte)

### 9.1 Descoberta importante: muitos "bugs" eram o servidor caído / cache
- **O 404 do "Estou Pronto"** (`POST /api/reservas/estou-pronto 404`) NÃO era bug de rota.
  A rota existe e está bem montada:
  - `app.js` linha 137: `app.use("/api/reservas", reservasRoutes)` ✓
  - `reservas.routes.js` linha 381: `router.post("/estou-pronto", handlerEstouPronto)` ✓
  → o 404 acontecia porque o SERVIDOR estava caído (Mongo em baixo pela rede instável do
    hotspot). Servidor morto = API não responde = 404. Com o servidor de pé, o 404 desaparece.
- **O botão "Convidar mais pessoas" que "deixa de funcionar"** = CACHE do browser.
  Só funciona após Ctrl+Shift+R porque o browser serve versão antiga dos .js em cache.
  → SOLUÇÃO PENDENTE: subir `?v=9` → `?v=10` (ou maior) em TODOS os scripts do
    hotel-dashboard.html para forçar o browser a largar a cache. Enquanto isto não for feito,
    o browser mistura versões antigas e novas do rm-core.js — o que faz reservas irem para
    sistemas diferentes de forma imprevisível.

### 9.2 Mapa confirmado dos sistemas (teste controlado, 1 reserva de cada vez)
- Botão **"RESERVAR"** (reserva simples) → aterra em coleção **`reservas`** (ANTIGO).
  Código exemplo: RM-MROOHCK7-WBP. SMS Twilio: STATUS accepted.
  NOTA: o código do rm-core.js (linha 922) diz chamar `/partilha/reserva-simples/criar`
  (NOVO), mas a reserva foi para `reservas` (ANTIGO) → sinal de que o browser corria versão
  ANTIGA do rm-core.js em cache. Confirmar após limpar cache.
- Botão **"PARTILHA"** → aterra em **`sharetrips` + `shareinvites`** (NOVO). Gera link com
  invite JWT + shareId. SMS Twilio: STATUS accepted.
- **1 reserva de partilha = 2 documentos** (sharetrips + shareinvites) — é o esperado,
  não é duplicação. Por isso "2 reservas feitas" mostravam "3 documentos".

### 9.3 SMS — pista nova
- Twilio devolve sempre `STATUS: accepted` e `FROM: null` (envio via messagingServiceSid).
- `accepted` ≠ `delivered`. Para saber se chega mesmo: painel Twilio → Monitor → Logs →
  Messaging → procurar o SID (ex.: SM1878f4923447cbcdac6d781cdaca5768) e ver estado final.
- Como o servidor andava a cair pela rede instável, é possível que parte das falhas de SMS
  fossem o servidor morrer a meio. Reavaliar com servidor estável (WiFi, não hotspot).

### 9.4 CAUSA RAIZ do "Sessão necessária" no RESERVAR+Convidar — ENCONTRADA
- Ao clicar "RESERVAR VIAGEM" (último passo, pagamento) com convidados, aparece pop-up
  "Sessão necessária", MESMO com login de hotel feito (e mesmo após re-login).
- **Causa exata:** a rota que cria a reserva exige o middleware ERRADO.
  - `partilha.routes.js` linha 1641: `router.post("/reserva-simples/criar", requireCliente, ...)`
  - Usa **`requireCliente`** (exige sessão de CLIENTE).
  - MAS o hotel-dashboard.html autentica via `/api/admin/parceiros/me` → sessão de
    **PARCEIRO/HOTEL**, não de cliente.
  - O próprio COMENTÁRIO da rota (linha 1636) diz "Autenticado (hotel)" — a intenção era
    exigir sessão de HOTEL. Puseram `requireCliente` por engano.
  - Resultado: tens sessão de hotel, a rota pede sessão de cliente → recusa → "Sessão necessária".

### 9.5 Correção do "Sessão necessária" — o que falta para a fazer BEM
A correção é trocar `requireCliente` pelo middleware que valida a sessão de parceiro/hotel
do dashboard. MAS há uma teia de autenticação a mapear primeiro (vários sistemas de login):
- `requireCliente` (utils/clienteAuth.js) — sessão de cliente
- `authGestorOrPartner` (middlewares/authGestorOrPartner.js) — cookie colab_token (gestor) OU X-Api-Key. Preenche req.partner.
- `authAdmin` (middlewares/authAdmin.js) — admin_token. Preenche req.admin.
- `auth.js` → alias para auth.middleware.js (authRequired, authRole, authColaboradorTipo)
- **FALTA IDENTIFICAR:** o middleware que protege `/api/admin/parceiros/me` — é ESSE que
  valida a sessão que o hotel-dashboard te dá, e é por ele que devemos trocar o requireCliente.
  Procurar nas rotas de admin/parceiros qual middleware protege o `/me`.

PASSOS para corrigir (próxima sessão, com cabeça fresca):
1. Identificar o middleware que protege `/api/admin/parceiros/me` (a sessão real do hotel).
2. Importá-lo no partilha.routes.js.
3. Trocar `requireCliente` por esse middleware na linha 1641.
4. VER O INTERIOR da rota (linhas 1641–1800): como usa a identidade da sessão para gravar
   `organizadorId` (que Classificações e SLA precisam). Garantir que funciona com a sessão
   de parceiro em vez de cliente — senão parte o registo do organizador.
5. git commit ANTES e DEPOIS. Testar: reserva com convidados deve criar sem "Sessão necessária".

### 9.6 Estado do git nesta sessão
- Commit `6930f1f` (estado a funcionar) + `2b7a16d` (env.example).
- GitHub sincronizado via push --force (substituiu versão antiga de 9 meses).
- Backup do .env em ..\env-backup-realmetropolis.txt (Ambiente de Trabalho / OneDrive).

### 9.7 PRIORIDADE para a próxima sessão (ordem sugerida)
1. **Rede estável primeiro** (WiFi, não hotspot) — o hotspot faz o Mongo cair e contamina todos os testes.
2. **Matar a cache:** subir `?v` nos scripts do hotel-dashboard.html. Isto sozinho pode
   resolver metade do caos (reservas a irem para sistemas diferentes).
3. **Reavaliar tudo com cache limpa e servidor estável:** confirmar onde o RESERVAR grava
   realmente (reservas ou shareinvites) quando corre o código NOVO.
4. **Corrigir o "Sessão necessária"** (secção 9.5).
5. **Só então** a consolidação final dos sistemas (PLANO secção 5).

---

## 10. "SESSÃO NECESSÁRIA" — DIAGNÓSTICO FECHADO + CORREÇÃO PRONTA

### Causa raiz CONFIRMADA (com prova nos ficheiros)
A rota `/api/partilha/reserva-simples/criar` (partilha.routes.js linha 1641) usa
`requireCliente`. Este middleware (utils/clienteAuth.js) só aceita:
- Cookies: `rm_cliente_token` / `cliente_token` / `token`
- Token com `typ === "cliente"` (rejeita qualquer outro: `if (typ && typ !== "cliente") return null`)

MAS a sessão de hotel/parceiro (criada em routes/parceiroInvite.routes.js) usa:
- Cookie: **`rm_parceiro_token`** (linhas 573, 633, 1055)
- Token com **`typ: "parceiro"`** (linhas 568, 621, 1051)

→ Incompatibilidade total: o requireCliente não encontra o cookie do parceiro e, mesmo que
encontrasse, rejeita o typ "parceiro". Logo → "Sessão necessária" mesmo com login de hotel.

Nota: `requireCliente` diz no comentário servir "cliente/hotel", mas na prática só aceita
`typ: "cliente"`. A sessão de hotel é `typ: "parceiro"`. Daí o bug.

### CORREÇÃO (aplicar na próxima sessão, com git commit antes e depois)

**Passo 1 — adicionar novo middleware em `src/utils/clienteAuth.js`:**
```js
export function requireClienteOuParceiro(req, res, next) {
  // 1) tenta sessão de cliente (lógica existente)
  const pc = getClientePayload(req);
  if (pc?.id) { req.clienteId = pc.id; req.clienteEmail = pc.email || null; return next(); }

  // 2) tenta sessão de parceiro/hotel (rm_parceiro_token, typ "parceiro")
  try {
    const secret = String(process.env.JWT_SECRET || "").trim();
    const tokenP = req.cookies?.rm_parceiro_token || req.cookies?.parceiro_token || "";
    if (tokenP && secret) {
      const p = jwt.verify(tokenP, secret);
      if (String(p?.typ || "").toLowerCase() === "parceiro" && p?.id) {
        req.clienteId    = p.id;      // reutiliza o campo que a rota já usa
        req.clienteEmail = p.email || null;
        req.parceiroId   = p.id;      // identidade do hotel (para organizadorId)
        req.parceiroEmpresa = p.empresa || null;
        return next();
      }
    }
  } catch (_) {}

  return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "Sessão necessária." });
}
```

**Passo 2 — em `src/routes/partilha.routes.js`:**
- No topo, no import do clienteAuth, adicionar `requireClienteOuParceiro`:
  `import { requireCliente, requireClienteOuParceiro } from "../utils/clienteAuth.js";`
- Linha 1641: trocar
  `router.post("/reserva-simples/criar", requireCliente, async (req, res) => {`
  por
  `router.post("/reserva-simples/criar", requireClienteOuParceiro, async (req, res) => {`

**Passo 3 — CRÍTICO — verificar o interior da rota (linhas 1641–1800):**
Confirmar como grava o `organizadorId`. Se usa `req.clienteId`, funciona (o novo middleware
preenche-o). Se usa algo específico de cliente que a sessão de parceiro não tem, ajustar para
usar `req.parceiroId`. NÃO aplicar sem verificar isto — senão as Classificações/SLA podem
deixar de encontrar a viagem (organizadorId errado ou vazio).

**Passo 4 — testar:** reserva com "+ Convidar mais pessoas" → deve criar SEM "Sessão necessária".
Confirmar que a viagem aparece nas Classificações e no SLA (organizadorId bem gravado).

### Ficheiros relevantes (todos já vistos nesta sessão)
- utils/clienteAuth.js — requireCliente / getClientePayload / injetarCliente
- routes/parceiroInvite.routes.js — cria a sessão de parceiro (rm_parceiro_token, typ parceiro)
- routes/partilha.routes.js — rota /reserva-simples/criar (linha 1641) a corrigir
- middlewares/authGestorOrPartner.js — sessão de gestor de frota (colab_token) — NÃO é a do hotel
- middlewares/authAdmin.js — sessão de admin (admin_token) — NÃO é a do hotel
