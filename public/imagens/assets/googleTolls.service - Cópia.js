export async function getTollsGoogle({ origin, destination }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY não definido no .env");

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: "DRIVE",
    extraComputations: ["TOLLS"],
    routingPreference: "TRAFFIC_AWARE",
    routeModifiers: { avoidTolls: false }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      // pede para vir tollInfo na resposta:
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo"
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Erro Google Routes API");

  const route = data?.routes?.[0];
  const tollInfo = route?.travelAdvisory?.tollInfo;

  // Se não houver preço conhecido, pode vir "unknown"
  // Aqui simplifico: somo os valores que vierem.
  const estimatedPrice = tollInfo?.estimatedPrice || [];
  const eur = estimatedPrice.find(p => p.currencyCode === "EUR");
  const tolls = eur ? Number(eur.units || 0) + Number(("0." + (eur.nanos || 0)).slice(0)) : 0;

  return { tolls, tollInfo, distanceMeters: route?.distanceMeters || 0, duration: route?.duration || "" };
}
