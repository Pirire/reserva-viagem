import { $, onClick } from "../../utils/dom.js";

export function initTripUI() {

  const panel = $("#tripPanel");

  onClick("#btnOpenReserve", () => {
    panel.classList.remove("hidden");
  });

  onClick("#btnCloseTrip", () => {
    panel.classList.add("hidden");
  });

}