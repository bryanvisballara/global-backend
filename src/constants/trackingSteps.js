const TRACKING_STATE_TEMPLATES = [
  { key: "order-received", label: "Orden recibida" },
  { key: "vehicle-search", label: "Busqueda del carro" },
  { key: "booking-and-shipping", label: "Booking y tracking naviera" },
  { key: "in-transit", label: "En transito" },
  { key: "nationalization", label: "Proceso de nacionalizacion" },
  { key: "port-exit", label: "Salida del puerto" },
  { key: "vehicle-preparation", label: "Alistamiento" },
  { key: "delivery", label: "Entrega" },
  { key: "registration", label: "Matricula" },
];

function buildTrackingStates() {
  return TRACKING_STATE_TEMPLATES.map((state) => ({
    ...state,
    confirmed: false,
    clientVisible: true,
    notes: "",
    media: [],
    updatedAt: null,
    confirmedAt: null,
  }));
}

function normalizeTrackingStates(states = []) {
  const statesByKey = new Map();

  states.forEach((state, index) => {
    if (!state) {
      return;
    }

    if (state.key) {
      statesByKey.set(String(state.key), state);
      return;
    }

    const fallbackTemplate = TRACKING_STATE_TEMPLATES[index];

    if (fallbackTemplate) {
      statesByKey.set(fallbackTemplate.key, state);
    }
  });

  return TRACKING_STATE_TEMPLATES.map((template, index) => {
    const sourceState = statesByKey.get(template.key) || states[index] || {};
    const legacyStatus = String(sourceState.status || "").toLowerCase();
    const confirmed = typeof sourceState.confirmed === "boolean"
      ? sourceState.confirmed
      : legacyStatus === "active" || legacyStatus === "completed";

    return {
      key: template.key,
      label: template.label,
      confirmed,
      clientVisible: typeof sourceState.clientVisible === "boolean" ? sourceState.clientVisible : true,
      notes: sourceState.notes ? String(sourceState.notes).trim() : "",
      media: Array.isArray(sourceState.media)
        ? sourceState.media
            .filter((item) => item && item.url)
            .map((item) => ({
              type: item.type || "image",
              category: item.category ? String(item.category).trim() : undefined,
              url: String(item.url).trim(),
              caption: item.caption ? String(item.caption).trim() : undefined,
              name: item.name ? String(item.name).trim() : undefined,
            }))
        : [],
      updatedAt: sourceState.updatedAt || null,
      confirmedAt: confirmed ? sourceState.confirmedAt || sourceState.updatedAt || null : null,
    };
  });
}

module.exports = {
  TRACKING_STATE_TEMPLATES,
  buildTrackingStates,
  normalizeTrackingStates,
  TRACKING_STEP_TEMPLATES: TRACKING_STATE_TEMPLATES,
  buildTrackingSteps: buildTrackingStates,
};