export const state = {
  trip: {
    partida: null,
    destino: null,
    data: null,
    categoria: "economica",
    preferencias: []
  },
  share: {
    active: false,
    people: 1,
    contacts: []
  },
  user: null
};

export function initState() {
  console.log("🧠 State inicializado");
}