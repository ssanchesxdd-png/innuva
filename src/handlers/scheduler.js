// src/handlers/scheduler.js
// Verifica a cada minuto se algum horario configurado bate com o horario atual,
// e se sim, sincroniza os cards de produto nos canais de envio
// (edita os cards existentes em vez de duplicar).

const cron = require('node-cron');
const { loadStore } = require('../storage');
const { publicarCards } = require('./publicar');

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

  console.log('Agendador de reenvio diário iniciado.');
}

module.exports = { iniciarAgendador };