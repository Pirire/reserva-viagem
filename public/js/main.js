import { initState } from "./core/state.js";
import { initEvents } from "./core/events.js";

// módulos
import { initTripModule } from "./modules/trip/trip.module.js";
import { initShareModule } from "./modules/share/share.module.js";
import { initMapModule } from "./modules/map/map.module.js";

console.log("🚀 App modular iniciada");

initState();
initEvents();

initMapModule();
initTripModule();
initShareModule();