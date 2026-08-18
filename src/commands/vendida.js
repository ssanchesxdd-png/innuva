// src/commands/vendida.js
// Comando /vendida: usado pela staff DENTRO da thread do ticket para confirmar a venda.
// Abre o modal de finalizacao (produto, cupom, foto de referencia...).

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { confirmarVenda } = require('../handlers/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vendida')
    .setDescription('Confirma a venda do produto deste ticket (use dentro da thread do ticket).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await confirmarVenda(interaction);
  }
};