// src/commands/comprar.js
// Comando /comprar: abre uma thread privada (ticket) para negociar a compra de um produto.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { loadStore } = require('../storage');
const { abrirTicket } = require('../handlers/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('comprar')
    .setDescription('Abre um atendimento privado para comprar uma conta.')
    .addStringOption(opt =>
      opt.setName('produto')
        .setDescription('Nome do produto que deseja comprar (opcional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const store = loadStore(interaction.guildId);

    if (!store.ticket.panelChannelId) {
      return interaction.reply({
        content: 'O sistema de tickets ainda não foi configurado. Peça para a staff usar `/config`.',
        flags: MessageFlags.Ephemeral
      });
    }

    const produtoNome = interaction.options.getString('produto');
    await abrirTicket(interaction, store, produtoNome);
  }
};