// index.js
// Ponto de entrada do bot: cria o client, carrega os comandos e inicia o agendador.

require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handleInteraction } = require('./src/handlers/interactions');
const { iniciarAgendador } = require('./src/handlers/scheduler');
const { verificarPendenciasExpiradas } = require('./src/handlers/sales');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

const commandsDir = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  client.commands.set(command.data.name, command);
  console.log(`📦 Comando carregado: /${command.data.name}`);
}

client.once('clientReady', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  iniciarAgendador(client);
  setInterval(() => verificarPendenciasExpiradas(client), 60000);
});

client.on('interactionCreate', (interaction) => {
  handleInteraction(interaction);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Falha ao conectar no Discord:', err.message);
  process.exit(1);
});

// Servidor keep-alive (hospedagem gratuita: Replit, Render, etc.)
require('./server');