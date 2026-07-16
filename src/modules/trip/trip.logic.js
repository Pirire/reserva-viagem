import { state } from "../../core/state.js";
import { $, onClick } from "../../utils/dom.js";

export function initTripLogic() {

  onClick(".cat-btn", (e, btn) => {
    document.querySelectorAll(".cat-btn")
      .forEach(b => b.classList.remove("selected"));

    btn.classList.add("selected");

    state.trip.categoria = btn.dataset.category;

    console.log("Categoria:", state.trip.categoria);
  });

  onClick("#btnReservar", () => {
    const partida = $("#inputPartida").value;
    const destino = $("#inputDestino").value;
    const data = $("#inputDateTime").value;

    state.trip = {
      ...state.trip,
      partida,
      destino,
      data
    };

    console.log("📦 Reserva:", state.trip);
  });

}