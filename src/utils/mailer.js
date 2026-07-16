import nodemailer from "nodemailer";

export function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendActivationEmail({ to, activationLink, empresa, tipo }) {

  const transporter = createTransport();

  const subject = "REALMETROPOLIS — Acesso à sua conta";

  const isMotorista = String(tipo || "").toLowerCase().includes("motorista") || String(tipo || "").toLowerCase().includes("driver");

  const html = `
  <!DOCTYPE html>
  <html lang="pt">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#050507;font-family:'Segoe UI',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050507;padding:40px 16px;">
      <tr><td align="center">
        <table width="100%" style="max-width:520px;background:#0a0b0e;border:1px solid rgba(255,255,255,.1);border-radius:18px;overflow:hidden;">

          <!-- Cabeçalho -->
          <tr>
            <td style="background:linear-gradient(135deg,#0d0e11,#07080a);padding:28px 32px 22px;border-bottom:1px solid rgba(255,255,255,.07);">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="width:40px;height:40px;border-radius:50%;border:1.5px solid rgba(212,216,223,.35);background:rgba(212,216,223,.06);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#c4c9d4;letter-spacing:.1em;text-align:center;line-height:40px;">RM</div>
                    <span style="margin-left:12px;font-size:12px;font-weight:700;color:#c4c9d4;letter-spacing:.2em;text-transform:uppercase;vertical-align:middle;">REALMETROPOLIS</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding:32px 32px 28px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff;">
                ${isMotorista ? '🚗 Conta Aprovada' : '✅ Conta Activada'}
              </h1>
              <p style="margin:0 0 24px;font-size:13px;color:#8b93a0;line-height:1.6;">
                ${empresa ? `<b style="color:#c4c9d4">${empresa}</b> — ` : ''}
                ${isMotorista
                  ? 'A sua conta de motorista foi aprovada. Defina a sua senha para começar.'
                  : `A sua conta foi criada como <b style="color:#c4c9d4">${tipo || 'parceiro'}</b>. Clique abaixo para definir a sua senha e activar o acesso.`
                }
              </p>

              <!-- Botão principal -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td align="center">
                    <a href="${activationLink}"
                       style="display:inline-block;padding:15px 36px;border-radius:13px;
                              background:linear-gradient(180deg,#dde2e8,#adb4be);
                              color:#060708;font-weight:700;font-size:14px;
                              text-decoration:none;letter-spacing:.06em;">
                      ${isMotorista ? '🔐 DEFINIR SENHA E ENTRAR' : '🔐 ACTIVAR CONTA'}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Informação adicional para motoristas -->
              ${isMotorista ? `
              <div style="background:rgba(25,214,139,.06);border:1px solid rgba(25,214,139,.15);border-radius:12px;padding:16px;margin-bottom:20px;">
                <p style="margin:0;font-size:12px;color:rgba(25,214,139,.8);line-height:1.6;">
                  <b>Como funciona:</b><br>
                  1. Clique no botão acima<br>
                  2. Defina a sua palavra-passe<br>
                  3. Aceda à sua área de motorista
                </p>
              </div>
              ` : ''}

              <!-- Link alternativo -->
              <p style="margin:0 0 6px;font-size:11px;color:#434a55;">Ou copie este link:</p>
              <p style="margin:0;font-size:11px;color:#5b6370;word-break:break-all;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px;">${activationLink}</p>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="padding:18px 32px;border-top:1px solid rgba(255,255,255,.06);">
              <p style="margin:0;font-size:11px;color:#434a55;text-align:center;">
                Este link é de uso único e expira em 48 horas.<br>
                REALMETROPOLIS · Serviço premium de transporte
              </p>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });
}