// src/commands/saldo.js
// Comando /saldo: cliente consulta o proprio saldo; staff adiciona/remove saldo de usuarios.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const { loadStore, saveStore, getBalance, addBalance } = require('../storage');

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoles = (process.env.STAFF_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return staffRoles.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('saldo')
    .setDescription('Consulta seu saldo ou (staff) adiciona/remove saldo de um usuário.')
    .addUserOption(opt =>
      opt.setName('membro')
        .setDescription('Usuário (apenas staff, junto com valor)')
        .setRequired(false))
    .addNumberOption(opt =>
      opt.setName('valor')
        .setDescription('Valor em R$ a adicionar ou remover (apenas staff)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('acao')
        .setDescription('Adicionar ou remover saldo (apenas staff)')
        .setRequired(false)
        .addChoices(
          { name: 'Adicionar', value: 'adicionar' },
          { name: 'Remover', value: 'remover' }
        )),

  async execute(interaction) {
    const store = loadStore(interaction.guildId);
    const membro = interaction.options.getUser('membro');
    const valor = interaction.options.getNumber('valor');
    const acao = interaction.options.getString('acao');

    // Consulta simples do proprio saldo
    if (!membro && !valor && !acao) {
      const saldo = getBalance(store, interaction.user.id);
      const totalComprado = store.sales.history
        .filter(c => c.buyerId === interaction.user.id)
        .reduce((acc, c) => acc + c.finalValue, 0);

      const embed = new EmbedBuilder()
        .setTitle(`💰 Saldo — ${store.storeName}`)
        .setDescription(
          `Olá ${interaction.user}! Seu saldo atual é:\n\n` +
          `💵 **R$ ${saldo.toFixed(2)}**\n` +
          `🧾 **Total comprado:** R$ ${totalComprado.toFixed(2)}`
        )
        .setColor(store.color || '#5865F2')
        .setFooter({ text: store.storeName, iconURL: store.logoUrl || undefined })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // Operacoes de staff
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para isso. Apenas a staff pode adicionar/remover saldo.',
        ephemeral: true
      });
    }

    if (!membro || !valor || !acao) {
      return interaction.reply({
        content: '❌ Para adicionar/remover saldo, informe o **membro**, o **valor** e a **ação**. Ex: `/saldo membro:@user valor:50 acao:Adicionar`',
        ephemeral: true
      });
    }

    if (valor <= 0) {
      return interaction.reply({ content: '❌ O valor deve ser maior que zero.', ephemeral: true });
    }

    const antes = getBalance(store, membro.id);
    const delta = acao === 'adicionar' ? valor : -valor;
    addBalance(store, membro.id, delta);
    const depois = getBalance(store, membro.id);
    saveStore(interaction.guildId, store);

    const embed = new EmbedBuilder()
      .setTitle(acao === 'adicionar' ? '💳 Saldo adicionado' : '💳 Saldo removido')
      .setDescription(
        `**Cliente:** <@${membro.id}>\n` +
        `**Valor:** ${delta > 0 ? '+' : ''}R$ ${delta.toFixed(2)}\n` +
        `**Por:** ${interaction.user.tag}\n\n` +
        `Saldo anterior: R$ ${antes.toFixed(2)}\n` +
        `**Novo saldo:** R$ ${depois.toFixed(2)}`
      )
      .setColor('#23A55A')
      .setFooter({ text: store.storeName, iconURL: store.logoUrl || undefined })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Avisa o cliente por DM
    try {
      await membro.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(acao === 'adicionar' ? '💳 Saldo adicionado' : '💳 Saldo removido')
            .setDescription(
              `Seu saldo na **${store.storeName}** foi ${acao === 'adicionar' ? 'adicionado' : 'removido'} em **R$ ${valor.toFixed(2)}**.\n\n` +
              `**Saldo atual:** R$ ${depois.toFixed(2)}`
            )
            .setColor(store.color || '#5865F2')
        ]
      }).catch(() => {});
    } catch (err) {
      // DM fechada, ignora
    }
  }
};