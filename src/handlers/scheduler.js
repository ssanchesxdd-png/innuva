// src/handlers/scheduler.js
// Verifica a cada minuto se algum horario configurado bate com o horario atual,
// e se sim, sincroniza os cards de produto nos canais de envio
// (edita os cards existentes em vez de duplicar).

const cron = require('node-cron');
const { loadStore, getDataDir } = require('../storage');
const { publicarCards } = require('./publicar');
const { fazerBackup } = require('./backups');
const { AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Fuso usado para comparar os horarios de envio configurados na loja.
// O container da Fly.io roda em UTC: usar new Date().getHours() faria os
// cards sairem 3h adiantados. Alteravel via env BOT_TZ se necessario.
const FUSO_HORARIO = process.env.BOT_TZ || 'America/Sao_Paulo';

// Hora atual "HH:MM" no fuso da loja. hourCycle h23 evita o "24:xx"
// que o Intl pode devolver a meia-noite em alguns ambientes.
function horaAtualNoFuso(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_HORARIO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const partes = {};
  for (const p of fmt.formatToParts(date)) partes[p.type] = p.value;
  const hh = partes.hour === '24' ? '00' : partes.hour;
  return `${hh}:${partes.minute}`;
}

function iniciarAgendador(client) {
  // Roda a cada minuto
  cron.schedule('* * * * *', async () => {
    const horaAtual = horaAtualNoFuso();

    for (const guild of client.guilds.cache.values()) {
      const store = loadStore(guild.id);
      const horarios = store.sales.sendTimes || [];
      const canais = store.sales.sendChannelIds || [];

      if (!horarios.includes(horaAtual) || canais.length === 0) continue;

      const res = await publicarCards(guild).catch(err => {
        console.error(`Erro ao sincronizar cards em ${guild.id}:`, err.message);
        return null;
      });
      if (res) {
        console.log(`[scheduler] Cards sincronizados em ${guild.name}: ${res.enviados} novos, ${res.editados} editados, ${res.removidos} removidos.`);
      }
    }
  });

  // Backup diario da loja as 03:00 (horario de Sao Paulo):
  // gera snapshot persistente em /data/backups/<guildId>/ e envia o JSON
  // na DM do dono (fallback: canal de logs privado).
  cron.schedule('0 3 * * *', async () => {
    console.log('[backup] Rotina diaria iniciada.');
    for (const guild of client.guilds.cache.values()) {
      try {
        const r = fazerBackup(guild.id, { motivo: 'diario' });
        if (!r.ok) {
          if (!/dados/i.test(r.error)) console.warn(`[backup] ${guild.name}: ${r.error}`);
          continue;
        }

        const dia = r.fileName.match(/^backup-(\d{4}-\d{2}-\d{2})-/)?.[1] || '';
        const arquivo = path.join(getDataDir(), `${guild.id}.json`);
        const attachment = new AttachmentBuilder(
          fs.readFileSync(arquivo),
          { name: `backup-innova-${dia}.json` }
        );

        let enviado = false;
        const owner = await client.users.fetch(guild.ownerId).catch(() => null);
        if (owner) {
          enviado = await owner.send({
            content: `💾 **Backup diário da loja** — ${dia}`,
            files: [attachment]
          }).then(() => true).catch(() => false);
        }
        if (!enviado) {
          const store = loadStore(guild.id);
          if (store.logs?.privateChannelId) {
            const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
            await logChannel?.send({ content: '💾 Backup diário da loja:', files: [attachment] }).catch(() => {});
          }
        }
        console.log(`[backup] diario: ${r.fileName} para ${guild.name}${enviado ? ' (DM do dono)' : ' (canal de logs)'}`);
      } catch (err) {
        console.error('[backup] erro:', err.message);
      }
    }
    console.log('[backup] Rotina diaria concluida.');
  }, { timezone: 'America/Sao_Paulo' });

  console.log('Agendador de reenvio diário iniciado.');
}

module.exports = { iniciarAgendador, horaAtualNoFuso };
