import { $, onClick } from "../../utils/dom.js";

export function initShareUI() {

  const sheet = $("#shareSheet");

  onClick("#btnPartilharAmigos", () => {
    sheet.classList.remove("hidden");
  });

  onClick("#btnCancelarPartilha", () => {
    sheet.classList.add("hidden");
  });

}