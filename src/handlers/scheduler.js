// src/handlers/scheduler.js
// Verifica a cada minuto se algum horario configurado bate com o horario atual,
// e se sim, sincroniza os cards de produto nos canais de envio
// (edita os cards existentes em vez de duplicar).

const cron = require('node-cron');
const { loadStore } = require('../storage');
const { publicarCards } = require('./publicar');
const { fazerBackup, listarBackups } = require('./backups');

function iniciarAgendador(client) {
  // Roda a cada minuto
  cron.schedule('* * * * *', async () => {
    const agora = new Date();
    const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

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

  // Backup diario dos dados da loja: copia o JSON de cada servidor para
  // /data/backups/<guildId>/ antes da limpeza automatica dos antigos.
  cron.schedule('0 3 * * *', async () => {
    console.log('[backup] Rotina diaria iniciada.');
    let feitos = 0;
    for (const guild of client.guilds.cache.values()) {
      try {
        const r = fazerBackup(guild.id, { motivo: 'diario' });
        if (r.ok) {
          feitos++;
          console.log(`[backup] ${guild.name}: ${r.fileName} (${(r.sizeBytes / 1024).toFixed(1)} KB, ${listarBackups(guild.id).length} no historico)`);
        } else if (r.error !== 'Essa loja ainda nao possui dados salvos.') {
          console.warn(`[backup] ${guild.name}: ${r.error}`);
        }
      } catch (err) {
        console.error(`[backup] Falha em ${guild.name}:`, err.message);
      }
    }
    console.log(`[backup] Rotina diaria concluida (${feitos} servidores com dados).`);
  }, { timezone: 'America/Sao_Paulo' });

  console.log('Agendador de reenvio diário iniciado.');
}

module.exports = { iniciarAgendador };