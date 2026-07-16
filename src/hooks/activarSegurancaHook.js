// src/hooks/activarSegurancaHook.js
// ══════════════════════════════════════════════════════════════
// Hook chamado SEMPRE que um colaborador do tipo "frota" é
// aprovado pelo admin. Activa automaticamente a segurança
// para a região (concelho) desse gestor.
//
// USO — adicionar em qualquer rota de aprovação de colaborador:
//
//   import { onColaboradorAprovado } from "../hooks/activarSegurancaHook.js";
//
//   // Depois de colaborador.aprovado = true; await colaborador.save();
//   await onColaboradorAprovado(colaborador);
// ══════════════════════════════════════════════════════════════

import { activarRegiao, desactivarRegiao } from "../services/regiaoSeguranca.service.js";
import logger from "../config/logger.js";

/**
 * Chamado quando um colaborador é aprovado.
 * Se for do tipo "frota", activa a segurança na sua região.
 */
export async function onColaboradorAprovado(colaborador) {
  if (!colaborador || colaborador.tipo !== "frota") return;

  const concelho = String(colaborador.concelho || colaborador.cidade || "").trim();
  if (!concelho) {
    logger.warn({ id: String(colaborador._id) }, "⚠️ Gestor de frota aprovado sem concelho definido");
    return;
  }

  activarRegiao(concelho, {
    gestorId:    String(colaborador._id),
    gestorNome:  colaborador.nome  || colaborador.empresa || "",
    gestorEmail: colaborador.email || "",
  });

  logger.info(
    { concelho, gestor: colaborador.nome || colaborador.email },
    `🛡️ Segurança activada para "${concelho}" — gestor de frota aprovado`
  );
}

/**
 * Chamado quando um colaborador é desactivado/removido.
 * Se for do tipo "frota", verifica se ainda há gestores na região.
 */
export async function onColaboradorDesactivado(colaborador) {
  if (!colaborador || colaborador.tipo !== "frota") return;

  const concelho = String(colaborador.concelho || colaborador.cidade || "").trim();
  if (!concelho) return;

  await desactivarRegiao(concelho);
}