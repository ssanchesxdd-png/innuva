// src/commands/restaurar.js
// Comando /restaurar (staff): volta os dados da loja a partir de um snapshot
// salvo no volume (/restaurar snapshot) ou de um arquivo .json enviado no chat
// (/restaurar arquivo).
//
// Seguranca:
// - Exige a opcao "confirmar" marcada (acao destrutiva por natureza).
// - ANTES de sobrescrever, salva automaticamente um snapshot "prerestauracao"
//   do estado atual — ou seja, ate uma restauracao equivocada e reversivel.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { loadStore } = require('../storage');
const {
  fazerBackup,
  listarBackups,
  lerBackup,
  validarStore,
  aplicarRestore
} = require('../handlers/backups');
const { publicarCards } = require('../handlers/publicar');

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoles = (process.env.STAFF_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return staffRoles.some(roleId => member.roles.cache.has(roleId));
}

function resumoTexto(resumo) {
  return (
    `🎮 **Produtos:** ${resumo.produtos}\n` +
    `🎟️ **Cupons:** ${resumo.cupons}\n` +
    `⏳ **Pendentes abertos:** ${resumo.pendentes}\n` +
    `🧾 **Compras no histórico:** ${resumo.compras}\n` +
    `💰 **Usuários com saldo:** ${resumo.saldosAtivos}\n` +
    `🎫 **Ticket configurado:** ${resumo.ticketConfigurado ? 'sim' : 'não'}\n` +
    `🏦 **Pix configurada:** ${resumo.pixConfigurada ? 'sim' : 'não'}`
  );
}

// Fluxo compartilhado das duas formas de restaurar.
// A interacao deve estar em estado "deferred"; todas as respostas usam editReply.
async function restaurar(interaction, dados, origemDescricao) {
  const storeAtual = loadStore(interaction.guildId);

  const validacao = validarStore(dados);
  if (!validacao.ok) {
    return interaction.editReply({
      content: '❌ Este arquivo não parece ser uma loja válida:\n' +
        validacao.erros.map(e => `• ${e}`).join('\n')
    });
  }

  const pre = fazerBackup(interaction.guildId, { motivo: 'prerestauracao' });
  if (!pre.ok) {
    return interaction.editReply({
      content: `🛑 **Nada foi restaurado:** falhou ao salvar o pre-restauração (${pre.error}). Tente novamente.`
    });
  }

  aplicarRestore(interaction.guildId, dados);

  // Re-sincroniza os cards de produto nos canais de venda, se houver canal configurado
  publicarCards(interaction.guild).catch(() => {});

  if (storeAtual.logs?.privateChannelId) {
    const logChannel = await interaction.guild.channels.fetch(storeAtual.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('♻️ Dados da loja restaurados')
        .setDescription(
          `**Origem:** ${origemDescricao}\n` +
          `**Pre-restauração salvo em:** \`${pre.fileName}\`\n` +
          `**Por:** ${interaction.user.tag}`
        )
        .setColor('#F0B232')
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  const totalBackups = listarBackups(interaction.guildId).length;
  const embed = new EmbedBuilder()
    .setTitle('✅ Loja restaurada com sucesso!')
    .setDescription(
      `**Origem:** ${origemDescricao}\n\n` +
      `${resumoTexto(validacao.resumo)}\n\n` +
      `↩️ **Se algo ficou errado**, restaure \`${pre.fileName}\` para voltar ao estado anterior.\n` +
      `🗄️ Snapshots no histórico: ${totalBackups}`
    )
    .setColor('#23A55A')
    .setFooter({ text: storeAtual.storeName || 'Loja', iconURL: storeAtual.logoUrl || undefined })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restaurar')
    .setDescription('Restaura os dados da loja a partir de um backup (apenas staff).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('snapshot')
        .setDescription('Restaura um snapshot já salvo pelo bot.')
        .addStringOption(opt =>
          opt.setName('arquivo')
            .setDescription('Nome exato do snapshot (copie do /backup listar)')
            .setRequired(true))
        .addBooleanOption(opt =>
          opt.setName('confirmar')
            .setDescription('Sim, quero substituir os dados atuais')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('arquivo')
        .setDescription('Restaura a partir de um arquivo .json enviado aqui no chat.')
        .addAttachmentOption(opt =>
          opt.setName('dados')
            .setDescription('Arquivo .json exportado pelo /backup enviar')
            .setRequired(true))
        .addBooleanOption(opt =>
          opt.setName('confirmar')
            .setDescription('Sim, quero substituir os dados atuais')
            .setRequired(true))),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!interaction.options.getBoolean('confirmar')) {
      return interaction.reply({
        content: '🛑 Marque **confirmar: Sim** para autorizar a substituição dos dados atuais. Isso muda produtos, saldos, cupons e histórico da loja.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();

    if (sub === 'snapshot') {
      const nomeArquivo = interaction.options.getString('arquivo');
      const r = lerBackup(interaction.guildId, nomeArquivo);
      if (!r.ok) {
        return interaction.editReply({ content: `❌ ${r.error}` });
      }
      return restaurar(interaction, r.dados, `\`${nomeArquivo}\``);
    }

    if (sub === 'arquivo') {
      const anexo = interaction.options.getAttachment('dados');
      if (!anexo.name.toLowerCase().endsWith('.json') || anexo.size > 5 * 1024 * 1024) {
        return interaction.editReply({ content: '❌ Envie um arquivo `.json` de até 5 MB.' });
      }

      let texto;
      try {
        const resposta = await fetch(anexo.url);
        texto = await resposta.text();
      } catch (err) {
        return interaction.editReply({ content: `❌ Falha ao baixar o arquivo: ${err.message}` });
      }

      let dados;
      try {
        dados = JSON.parse(texto);
      } catch (err) {
        return interaction.editReply({ content: `❌ O arquivo não contém um JSON válido: ${err.message}` });
      }

      return restaurar(interaction, dados, `arquivo \`${anexo.name}\``);
    }
  }
};