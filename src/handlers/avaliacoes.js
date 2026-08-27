// src/handlers/avaliacoes.js
// Sistema de avaliacao de clientes pela staff + resumo de historico.
//
// - Notas escritas: maximo 2 por cliente, cada uma com estrelas (1 a 4).
// - Estrelas: sem limite de avaliacoes. Quando o cliente ja tem 2 notas,
//   as estrelas viram voto de CONCORDAR (3-4 estrelas) ou DISCORDAR
//   (1-2 estrelas) com as notas existentes.
//
// - Assumir ticket: a staff recebe um resumo do historico do cliente
//   (compras anteriores, notas da staff e media das estrelas) para saber
//   como se portar no atendimento.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} = require('discord.js');
const { loadStore, saveStore } = require('../storage');

const MAX_NOTAS = 2;
const MAX_ESTRELAS = 4;
const MINUTOS_FECHAMENTO = 10; // fallback: fecha o canal se a staff nao avaliar

// ---------- PERFIL DE AVALIACAO ----------

// Leitura sem mutar o store (para resumos)
function getPerfil(store, userId) {
  const p = store.avaliacoes?.[userId];
  if (!p) return { notas: [], estrelas: { soma: 0, votos: 0 }, votosNotas: [] };
  return {
    notas: Array.isArray(p.notas) ? p.notas : [],
    estrelas: p.estrelas || { soma: 0, votos: 0 },
    votosNotas: Array.isArray(p.votosNotas) ? p.votosNotas : []
  };
}

// Leitura garantindo estrutura completa (para gravacao)
function tocarPerfil(store, userId) {
  if (!store.avaliacoes) store.avaliacoes = {};
  if (!store.avaliacoes[userId]) {
    store.avaliacoes[userId] = { notas: [], estrelas: { soma: 0, votos: 0 }, votosNotas: [] };
  }
  const p = store.avaliacoes[userId];
  if (!Array.isArray(p.notas)) p.notas = [];
  if (!p.estrelas || typeof p.estrelas.soma !== 'number') p.estrelas = { soma: 0, votos: 0 };
  if (!Array.isArray(p.votosNotas)) p.votosNotas = [];
  return p;
}

function mediaEstrelas(perfil) {
  if (!perfil.estrelas.votos) return null;
  return Math.round((perfil.estrelas.soma / perfil.estrelas.votos) * 10) / 10;
}

function estrelasEmoji(n) {
  return '⭐'.repeat(Math.max(0, Math.min(MAX_ESTRELAS, n))) || '—';
}
// ---------- RESUMO DO CLIENTE (mostrado ao assumir o ticket) ----------

function montarResumoCliente(store, userId) {
  const perfil = getPerfil(store, userId);
  const compras = (store.sales?.history || []).filter(c => c.buyerId === userId);
  const linhas = [];

  if (compras.length > 0) {
    const gasto = compras.reduce((s, c) => s + (c.finalValue || 0), 0);
    const ultima = compras[compras.length - 1];
    const ultimos = compras.slice(-3).map(c => c.productName).join(', ');
    linhas.push(
      `🛒 **${compras.length} compra${compras.length > 1 ? 's' : ''}** — R$ ${gasto.toFixed(2)} no total\n` +
      `> Últimas: ${ultimos}\n` +
      `> Última: ${ultima.date ? new Date(ultima.date).toLocaleDateString('pt-BR') : '?'}`
    );
  } else {
    linhas.push('🛒 Nenhuma compra registrada ainda — primeiro atendimento.');
  }

  const media = mediaEstrelas(perfil);
  if (media !== null) {
    linhas.push(`⭐ Média das avaliações: **${media}/4** (${perfil.estrelas.votos} avaliação(ões))`);
  } else {
    linhas.push('⭐ Nenhuma avaliação por estrelas ainda.');
  }

  if (perfil.notas.length > 0) {
    const notasTxt = perfil.notas.map(n =>
      `> ${estrelasEmoji(n.estrelas)} — "${n.texto}" *(por ${n.staffTag}${n.date ? `, ${new Date(n.date).toLocaleDateString('pt-BR')}` : ''})*`
    );
    linhas.push(`📝 **Notas da staff (${perfil.notas.length}/${MAX_NOTAS}):**\n${notasTxt.join('\n')}`);
  } else {
    linhas.push(`📝 Nenhuma nota da staff (0/${MAX_NOTAS}).`);
  }

  // Alerta de cliente problemático
  const notaNegativa = perfil.notas.some(n => n.estrelas <= 2);
  if ((media !== null && media <= 2) || notaNegativa) {
    linhas.push('⚠️ **Atenção:** histórico negativo com este cliente — redobre o cuidado no atendimento.');
  }

  return linhas.join('\n\n');
}

function resumoClienteContainer(store, userId, clienteTag) {
  return new ContainerBuilder()
    .setAccentColor(0xF0B232)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**📋 Resumo do cliente${clienteTag ? ` — ${clienteTag}` : ''}**\n\n${montarResumoCliente(store, userId)}`
      )
    );
}

// ---------- FLUXO DE AVALIACAO ----------

function avaliacaoSelectRow(clienteId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`aval:estrelas:${clienteId}`)
      .setPlaceholder('⭐ Avaliar com estrelas (1 a 4)')
      .addOptions([
        { label: '⭐ (1/4)', value: '1', description: 'Péssimo — sinaliza discordância das notas' },
        { label: '⭐⭐ (2/4)', value: '2', description: 'Ruim — sinaliza discordância das notas' },
        { label: '⭐⭐⭐ (3/4)', value: '3', description: 'Bom — sinaliza concordância com as notas' },
        { label: '⭐⭐⭐⭐ (4/4)', value: '4', description: 'Ótimo — sinaliza concordância com as notas' }
      ])
  );
}
// Mensagem ephemeral com a avaliacao, enviada a staff no fim do atendimento
async function iniciarAvaliacao(interaction, store, clienteId) {
  const perfil = getPerfil(store, clienteId);
  const media = mediaEstrelas(perfil);
  const cheio = perfil.notas.length >= MAX_NOTAS;

  const status =
    `📝 Notas: **${perfil.notas.length}/${MAX_NOTAS}**` +
    (media !== null ? ` · ⭐ Média atual: **${media}/4** (${perfil.estrelas.votos} avaliação(ões))` : '') +
    (cheio ? `\n⚠️ Este cliente já tem o máximo de notas. Use as estrelas para **concordar** (3-4⭐) ou **discordar** (1-2⭐) das notas existentes.` : '');

  const container = new ContainerBuilder()
    .setAccentColor(0x23A55A)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**🏁 Atendimento finalizado!**\n\nAntes de fechar, avalie o cliente <@${clienteId}>:\n\n${status}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(avaliacaoSelectRow(clienteId))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`aval:nota:${clienteId}`).setLabel('Avaliar com nota').setStyle(ButtonStyle.Primary).setEmoji('📝'),
        new ButtonBuilder().setCustomId(`aval:pular:${clienteId}`).setLabel('Fechar sem avaliar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
      )
    );

  return interaction.reply({
    components: [container],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}
function confirmacaoContainer(texto, clienteId) {
  return new ContainerBuilder()
    .setAccentColor(0x23A55A)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(texto))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`aval:fechar:${clienteId}`).setLabel('Fechar ticket agora').setStyle(ButtonStyle.Secondary).setEmoji('🔒')
      )
    );
}

// Seletor de estrelas da avaliacao
async function handleAvaliacaoSelect(interaction) {
  const clienteId = interaction.customId.split(':')[2];
  const estrelas = parseInt(interaction.values[0], 10);
  if (!(estrelas >= 1 && estrelas <= MAX_ESTRELAS)) return interaction.deferUpdate();

  const store = loadStore(interaction.guildId);
  const perfil = tocarPerfil(store, clienteId);
  let detalhe;

  if (perfil.notas.length >= MAX_NOTAS) {
    const concorda = estrelas >= 3;
    perfil.votosNotas.push({
      staffId: interaction.user.id,
      staffTag: interaction.user.tag,
      voto: concorda ? 'concordo' : 'discordo',
      estrelas,
      date: Date.now()
    });
    detalhe = concorda
      ? 'Notas no máximo — seu voto foi registrado como ✅ **CONCORDO** com as notas existentes.'
      : 'Notas no máximo — seu voto foi registrado como ❌ **DISCORDO** das notas existentes.';
  } else {
    detalhe = 'Avaliação por estrelas registrada. Você também pode deixar uma **nota escrita** (máx. 2 por cliente).';
  }

  perfil.estrelas.soma += estrelas;
  perfil.estrelas.votos += 1;
  saveStore(interaction.guildId, store);

  const media = mediaEstrelas(perfil);
  return interaction.update({
    components: [confirmacaoContainer(
      `⭐ **${estrelasEmoji(estrelas)} (${estrelas}/4)** registradas para <@${clienteId}>.\n\n${detalhe}\n\n` +
      `*Média atual: ${media}/4 em ${perfil.estrelas.votos} avaliação(ões).*`,
      clienteId
    )],
    flags: MessageFlags.IsComponentsV2
  });
}
// Botao "Avaliar com nota" -> modal
async function abrirModalNota(interaction, clienteId) {
  const modal = new ModalBuilder()
    .setCustomId(`aval:modal:${clienteId}`)
    .setTitle('Avaliar cliente')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('aval_estrelas')
          .setLabel(`Estrelas (1 a ${MAX_ESTRELAS})`)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(1)
          .setPlaceholder('Ex: 4')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('aval_texto')
          .setLabel('Nota sobre o cliente')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(3)
          .setMaxLength(500)
          .setPlaceholder('Como foi o comportamento do cliente no atendimento?')
          .setRequired(true)
      )
    );
  return interaction.showModal(modal);
}
// Submit do modal de nota
async function handleAvaliacaoModal(interaction) {
  const clienteId = interaction.customId.split(':')[2];
  const estrelas = parseInt(interaction.fields.getTextInputValue('aval_estrelas').trim(), 10);
  const texto = interaction.fields.getTextInputValue('aval_texto').trim();

  if (!(estrelas >= 1 && estrelas <= MAX_ESTRELAS)) {
    return interaction.reply({
      content: `❌ Estrelas inválidas. Digite um número de **1 a ${MAX_ESTRELAS}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const store = loadStore(interaction.guildId);
  const perfil = tocarPerfil(store, clienteId);

  if (perfil.notas.length >= MAX_NOTAS) {
    return interaction.reply({
      content: `⚠️ Este cliente já tem o máximo de **${MAX_NOTAS} notas**. Use o seletor de ⭐ estrelas para **concordar** (3-4⭐) ou **discordar** (1-2⭐) das notas existentes.`,
      flags: MessageFlags.Ephemeral
    });
  }

  perfil.notas.push({
    texto,
    estrelas,
    staffId: interaction.user.id,
    staffTag: interaction.user.tag,
    channelId: interaction.channelId,
    date: Date.now()
  });
  perfil.estrelas.soma += estrelas;
  perfil.estrelas.votos += 1;
  saveStore(interaction.guildId, store);

  const media = mediaEstrelas(perfil);
  return interaction.reply({
    components: [confirmacaoContainer(
      `📝 **Nota registrada** para <@${clienteId}>:\n\n> ${estrelasEmoji(estrelas)} — "${texto}"\n\n` +
      `*Notas: ${perfil.notas.length}/${MAX_NOTAS} · Média: ${media}/4 (${perfil.estrelas.votos} avaliação(ões))*`,
      clienteId
    )],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}
// Botoes da avaliacao (nota / pular / fechar)
async function handleAvaliacaoButton(interaction) {
  const [, acao, clienteId] = interaction.customId.split(':');

  if (acao === 'nota') return abrirModalNota(interaction, clienteId);

  if (acao === 'pular') {
    await interaction.update({
      components: [new ContainerBuilder()
        .setAccentColor(0x2B2D31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('🗑️ Sem avaliação. Fechando o ticket...'))],
      flags: MessageFlags.IsComponentsV2
    }).catch(() => {});
    return fecharCanalAvaliacao(interaction.channel, interaction.user.tag);
  }

  if (acao === 'fechar') {
    await interaction.update({
      components: [new ContainerBuilder()
        .setAccentColor(0x2B2D31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('🔒 Avaliação registrada. Fechando o ticket...'))],
      flags: MessageFlags.IsComponentsV2
    }).catch(() => {});
    return fecharCanalAvaliacao(interaction.channel, interaction.user.tag);
  }

  return interaction.deferUpdate();
}

// ---------- FECHAMENTO DO CANAL ----------

function fecharCanalAvaliacao(canal, tagStaff) {
  if (!canal) return;
  setTimeout(() => canal.delete(`Atendimento finalizado — avaliado por ${tagStaff}`).catch(() => {}), 3000);
}

// Fallback: se a staff nao responder a avaliacao, o canal fecha sozinho
function agendarFechamento(canal, minutos = MINUTOS_FECHAMENTO) {
  if (!canal) return;
  setTimeout(() => canal.delete('Ticket finalizado (avaliação não respondida)').catch(() => {}), minutos * 60 * 1000);
}

module.exports = {
  MAX_NOTAS,
  MAX_ESTRELAS,
  getPerfil,
  montarResumoCliente,
  resumoClienteContainer,
  iniciarAvaliacao,
  handleAvaliacaoButton,
  handleAvaliacaoSelect,
  handleAvaliacaoModal,
  agendarFechamento
};