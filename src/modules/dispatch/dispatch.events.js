import mongoose from "mongoose";
import { acceptDispatch } from "./dispatch.accept.service.js";
import { moveToNextDriver } from "./dispatch.offer.service.js";
import { cancelarERedespachar } from "./dispatch.cancel.service.js";
import DispatchSession from "../../models/DispatchSession.js";

export function registerDispatchEvents(io) {

  io.on("connection", (socket) => {

    console.log("🔌 Socket conectado:", socket.id);

    // ─────────────────────────────
    // DRIVER ENTRA NA CORRIDA
    // ─────────────────────────────
    socket.on("join_trip", ({ tripId, driverId }) => {
      if (!tripId) return;

      socket.join(`trip_${tripId}`);
      socket.join(`driver_${driverId}`);

      console.log("🚗 Driver entrou na trip:", tripId);
    });

    // ─────────────────────────────
    // DRIVER ACEITA VIAGEM
    // ─────────────────────────────
    socket.on("trip_accept", async (data) => {
      const result = await acceptDispatch(data);

      if (result.ok) {

        // Gravar o motorista atribuído NA PRÓPRIA VIAGEM (Trip) —
        // sem isto, só a DispatchSession (tabela de controlo
        // temporária) sabia quem aceitou. Qualquer rota que
        // pergunte "quem é o motorista desta viagem?" (ex: GET
        // /reservas/motorista-atribuido, usada pelo polling do
        // cliente) nunca tinha resposta, porque a Trip nunca era
        // atualizada. Nome/veículo/matrícula não se gravam aqui de
        // propósito — ficam a cargo de quem lê (populate no
        // driverId + procura dinâmica do veículo por motoristaId),
        // a mesma fonte de verdade única já usada no resto do
        // sistema, em vez de um snapshot que podia desatualizar.
        try {
          const _col = mongoose.connection.db.collection("viagens");
          await _col.updateOne(
            { _id: new mongoose.Types.ObjectId(data.tripId) },
            {
              $set: {
                "driver.driverId": new mongoose.Types.ObjectId(data.driverId),
                "driver.atribuidoEm": new Date(),
                status: "assigned",
              },
            }
          );
        } catch (errTrip) {
          console.error("⚠️ [trip_accept] falha ao gravar motorista na Trip:", errTrip?.message);
        }

        // Revelar passageiro após aceite
        let _pass = null;
        try {
          const _col = mongoose.connection.db.collection("viagens");
          const _v   = await _col.findOne({ _id: new mongoose.Types.ObjectId(data.tripId) }).catch(()=>null);
          if (_v) _pass = {
            nome:     _v.nome     || _v.nomeHospede     || _v.extras?.nomePassageiro  || "Passageiro",
            contacto: _v.contacto || _v.telefoneHospede || _v.extras?.contactoPassageiro || "",
          };
        } catch(_e) {}

        const _payload = { ...result, passageiro: _pass };
        io.to(`trip_${data.tripId}`).emit("dispatch_accepted", _payload);
        io.to(`driver_${data.driverId}`).emit("dispatch_accepted", _payload);

        console.log("✅ Trip aceite por:", data.driverId);

      } else {
        socket.emit("trip_accept_failed", result);
      }
    });

    // ─────────────────────────────
    // DRIVER REJEITA VIAGEM
    // ─────────────────────────────
    socket.on("trip_reject", async ({ tripId, driverId }) => {

      console.log("❌ Trip rejeitada por:", driverId);

      await moveToNextDriver(tripId);

      const session = await DispatchSession.findOne({ tripId });

      io.to(`trip_${tripId}`).emit("dispatch_next", {
        tripId,
        currentIndex: session?.currentIndex || 0,
      });

    });

    // ─────────────────────────────
    // DRIVER CANCELA RECOLHA (já tinha aceite, mas cancela antes de
    // iniciar — por ação própria, ou por não responder a tempo ao
    // aviso "hora de partir"). Procura logo um substituto, excluindo
    // este motorista; se não houver mais ninguém, a viagem fica
    // pendente, visível no despacho manual do admin.
    // ─────────────────────────────
    socket.on("cancelar_recolha", async ({ tripId, driverId }) => {
      console.log("🚫 Recolha cancelada por:", driverId, "— viagem:", tripId);

      try {
        const resultado = await cancelarERedespachar(tripId, driverId, io);
        socket.emit("cancelar_recolha_ok", { tripId, ...resultado });
      } catch (err) {
        console.error("⚠️ [cancelar_recolha] falhou:", err?.message);
        socket.emit("cancelar_recolha_ok", { tripId, ok: false, reason: "ERRO_INTERNO" });
      }
    });

    // ─────────────────────────────
    // DRIVER DESCONECTA
    // ─────────────────────────────
    socket.on("disconnect", (reason) => {
      console.log("🔌 Socket desconectado:", socket.id, reason);
    });

  });
}