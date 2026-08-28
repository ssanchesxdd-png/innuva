// index.js
// Ponto de entrada do bot: cria o client, carrega os comandos e inicia o agendador.

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handleInteraction, handleMessage } = require('./src/handlers/interactions');
const { ticketMessageHook } = require('./src/handlers/tickets');
const { iniciarAgendador } = require('./src/handlers/scheduler');
const { verificarPendenciasExpiradas } = require('./src/handlers/sales');
const { aoEntrarNovoMembro } = require('./src/handlers/roles');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Necessario para o evento guildMemberAdd (cargo de Novo Membro).
    // Exige "Server Members Intent" ativado no Discord Developer Portal.
    GatewayIntentBits.GuildMembers
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

  // Status "Transmitindo"
  client.user.setPresence({
    activities: [{
      name: 'a melhor loja de roblox br',
      type: ActivityType.Streaming,
      url: 'https://www.twitch.tv/roblox'
    }],
    status: 'online'
  });

  iniciarAgendador(client);
  setInterval(() => verificarPendenciasExpiradas(client), 60000);

  // Auto-registro dos comandos de barra no servidor (efeito imediato).
  // Usa CLIENT_ID/GUILD_ID do ambiente (secrets no Fly.io); se ausentes,
  // mantem o registro manual via npm run register.
  try {
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;
    if (clientId && guildId && process.env.DISCORD_TOKEN) {
      const { REST, Routes } = require('discord.js');
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      const body = [...client.commands.values()].map(c => c.data.toJSON());
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`🛠️ ${body.length} comandos registrados no servidor (${guildId}).`);
    } else {
      console.warn('⚠️ CLIENT_ID/GUILD_ID ausentes: registro automatico pulado.');
    }
  } catch (err) {
    console.error('❌ Falha ao registrar comandos no boot:', err.message);
  }
});

client.on('interactionCreate', (interaction) => {
  handleInteraction(interaction);
});

client.on('messageCreate', (message) => {
  handleMessage(message);
  ticketMessageHook(message);
});

// Cargo de "Novo Membro" quando alguem entra no servidor
client.on('guildMemberAdd', (member) => {
  aoEntrarNovoMembro(member.guild, member).catch(err => {
    console.error('[cargos] Erro ao processar novo membro:', err.message);
  });
});

// Evita que erros inesperados derrubem o bot inteiro
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Erro não tratado (bot continua online):', err?.message || err);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Falha ao conectar no Discord:', err.message);
  process.exit(1);
});

// Servidor keep-alive (hospedagem gratuita: Replit, Render, etc.)
require('./server');