import nodemailer from "nodemailer";
import Motorista from "../models/Motorista.js";
import Veiculo from "../models/Veiculo.js";
import NotificationLog from "../models/NotificationLog.js";
import logger from "../config/logger.js";

const TZ = "Europe/Lisbon";

// dias antes
const WINDOWS = [15, 7, 2];

function startOfDay(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function daysDiff(a, b){
  // b - a em dias (inteiro)
  const da = startOfDay(a).getTime();
  const db = startOfDay(b).getTime();
  return Math.round((db - da) / (24*60*60*1000));
}

function parseValidDate(v){
  const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

function buildTransport(){
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if(!host || !user || !pass){
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendEmail({ to, subject, html }){
  const transporter = buildTransport();
  if(!transporter){
    logger.warn("⚠️ SMTP não configurado — verifique SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS");
    return { ok:false, reason:"smtp-not-configured" };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({ from, to, subject, html });
  return { ok:true };
}

function docEntriesMotorista(m){
  const docs = m?.documentos || {};
  const map = [
    ["cartaConducao", "Carta de Condução"],
    ["cc", "Cartão de Cidadão (CC)"],
    ["tResidencia", "Título de Residência"],
    ["tvde", "Permissão TVDE"],
    ["registoCriminal", "Registo Criminal"],
  ];
  return map.map(([k,label]) => ({
    docKey: k,
    label,
    validade: parseValidDate(docs?.[k]?.validade),
    url: docs?.[k]?.file?.url || "",
  }));
}

function docEntriesVeiculo(v){
  const docs = v?.documentos || {};
  const map = [
    ["seguro", "Seguro / Carta Verde"],
    ["inspecao", "Inspeção"],
    ["dua", "DUA"],
  ];
  return map.map(([k,label]) => ({
    docKey: k,
    label,
    validade: parseValidDate(docs?.[k]?.validade),
    url: docs?.[k]?.file?.url || "",
  }));
}

async function notifyOne({ targetType, targetId, docKey, validade, daysBefore, to, title, label }){
  if(!to) return;

  // tenta gravar log (se já existir, não envia)
  try{
    await NotificationLog.create({
      targetType,
      targetId,
      docKey,
      validade,
      daysBefore,
      sentTo: String(to || ""),
    });
  }catch(e){
    // duplicado = já enviado
    if(String(e?.code) === "11000") return;
    logger.error({ err: e }, "❌ NotificationLog create erro");
    return;
  }

  const vStr = validade.toLocaleDateString("pt-PT");
  const subject = `⚠️ Documento a vencer: ${label} (${daysBefore} dias) — ${title}`;

  const html = `
    <div style="font-family:Arial;max-width:700px;margin:auto;background:#111;color:#fff;padding:18px;border-radius:12px">
      <h2 style="margin:0 0 10px 0;color:#f2d37b">Aviso de vencimento (REALMETROPOLIS)</h2>
      <p style="color:#ddd;line-height:1.5">
        O documento <b>${label}</b> de <b>${title}</b> vence em <b>${vStr}</b>.
      </p>
      <p style="color:#ddd;line-height:1.5">
        Faltam <b>${daysBefore} dias</b> para o vencimento.
      </p>
      <p style="color:#aaa;font-size:12px;margin-top:14px">
        Notificação automática (15 / 7 / 2 dias).
      </p>
    </div>
  `;

  try{
    await sendEmail({ to, subject, html });
    logger.info({ targetType, docKey, to, daysBefore }, '📩 Notificação de vencimento enviada');
  }catch(e){
    logger.error({ err: e }, "❌ Erro ao enviar email de notificação");
  }
}

export async function runExpiryNotifications(now = new Date()){
  const adminEmail = String(process.env.ADMIN_NOTIFY_EMAIL || "").trim();

  // MOTORISTAS
  const motoristas = await Motorista.find().lean();
  for(const m of motoristas){
    const title = m?.nome || "Motorista";
    const holderEmail = String(m?.email || "").trim();

    const docs = docEntriesMotorista(m);
    for(const d of docs){
      if(!d.validade) continue;

      const left = daysDiff(now, d.validade);
      if(!WINDOWS.includes(left)) continue;

      // envia para admin
      if(adminEmail){
        await notifyOne({
          targetType: "motorista",
          targetId: m._id,
          docKey: d.docKey,
          validade: d.validade,
          daysBefore: left,
          to: adminEmail,
          title,
          label: d.label,
        });
      }

      // envia para titular
      if(holderEmail){
        await notifyOne({
          targetType: "motorista",
          targetId: m._id,
          docKey: d.docKey,
          validade: d.validade,
          daysBefore: left,
          to: holderEmail,
          title,
          label: d.label,
        });
      }
    }
  }

  // VEÍCULOS (se teu schema tiver docs+validade)
  const veiculos = await Veiculo.find().lean();
  for(const v of veiculos){
    const title = v?.matricula || "Veículo";
    const holderEmail = String(v?.email || v?.ownerEmail || "").trim(); // se existir no teu schema

    const docs = docEntriesVeiculo(v);
    for(const d of docs){
      if(!d.validade) continue;

      const left = daysDiff(now, d.validade);
      if(!WINDOWS.includes(left)) continue;

      if(adminEmail){
        await notifyOne({
          targetType: "veiculo",
          targetId: v._id,
          docKey: d.docKey,
          validade: d.validade,
          daysBefore: left,
          to: adminEmail,
          title,
          label: d.label,
        });
      }

      if(holderEmail){
        await notifyOne({
          targetType: "veiculo",
          targetId: v._id,
          docKey: d.docKey,
          validade: d.validade,
          daysBefore: left,
          to: holderEmail,
          title,
          label: d.label,
        });
      }
    }
  }
}