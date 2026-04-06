const TRACKING_STEP_TEMPLATES = [
  { key: "request-received", label: "Solicitud recibida" },
  { key: "purchase-confirmed", label: "Compra confirmada" },
  { key: "origin-logistics", label: "Logistica en origen" },
  { key: "in-transit", label: "En transito" },
  { key: "customs", label: "Proceso aduanal" },
  { key: "local-delivery", label: "Entrega local" },
  { key: "completed", label: "Entrega completada" }
];

function buildTrackingSteps() {
  return TRACKING_STEP_TEMPLATES.map((step, index) => ({
    ...step,
    status: index === 0 ? "active" : "pending",
    notes: "",
    media: [],
    updatedAt: null,
  }));
}

module.exports = {
  TRACKING_STEP_TEMPLATES,
  buildTrackingSteps,
};