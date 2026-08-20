// src/handlers/tickets.js
// Toda a logica de abrir um ticket (thread), finalizar venda (modal com cupom,
// saldo e foto de referencia) e escolher a forma de pagamento.

const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');
const { loadStore, saveStore, generateId, getBalance, addBalance } = require('../storage');
const { privateLogEmbed, ticketPanelEmbed } = require('../utils/embeds');
const { aplicarCupom, calcularDesconto, registrarUso } = require('./coupons');
const { registrarPendente, finalizarCompra } = require('./sales');

// Guarda em memoria qual produto cada thread de ticket se refere
const ticketProdutoMap = new Map();

// Guarda a sessao da venda em andamento: threadId -> dados do modal
const sessaoVendaMap = new Map();

async function abrirTicket(interaction, store, produtoNomeSugerido) {
  const panelChannel = await interaction.guild.channels.fetch(store.ticket.panelChannelId).catch(() => null);

  if (!panelChannel) {
    return interaction.reply({
      content: 'O canal de tickets configurado nao foi encontrado. Avise a staff.',
      flags: MessageFlags.Ephemeral
    });
  }

  const thread = await panelChannel.threads.create({
    name: `ticket-${interaction.user.username}`.slice(0, 90),
    type: ChannelType.PrivateThread,
    reason: `Ticket aberto por ${interaction.user.tag}`
  });

  await thread.members.add(interaction.user.id);

  if (produtoNomeSugerido) {
    ticketProdutoMap.set(thread.id, produtoNomeSugerido);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎫 Atendimento — ${store.storeName}`)
    .setDescription(
      `Olá ${interaction.user}, seja bem-vindo(a)!\n\n` +
      (produtoNomeSugerido ? `**Produto de interesse:** ${produtoNomeSugerido}\n\n` : '') +
      'Aguarde um membro da equipe para continuar o atendimento.\n' +
      'Forma de pagamento: **Pix** ou **Saldo** (veja seu saldo com `/saldo`).'
    )
    .setColor(store.color || '#5865F2');

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:confirmar_venda')
      .setLabel('Confirmar Venda')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('ticket:fechar')
      .setLabel('Fechar Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );

  await thread.send({ embeds: [embed], components: [confirmRow] });

  // Notifica o log privado (staff) sobre o novo ticket
  if (store.logs.privateChannelId) {
    const logChannel = await interaction.guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logEmbed = privateLogEmbed(
        store,
        '🎫 Novo ticket aberto',
        `**Usuário:** ${interaction.user.tag}\n**Thread:** ${thread}\n` +
        (produtoNomeSugerido ? `**Produto:** ${produtoNomeSugerido}` : '')
      );
      await logChannel.send({ embeds: [logEmbed] });
    }
  }

  await interaction.reply({ content: `Ticket criado: ${thread}`, flags: MessageFlags.Ephemeral });
}

// Usado tanto pelo botao "Confirmar Venda" quanto pelo comando /vendida.
async function confirmarVenda(interaction) {
  if (!interaction.channel.isThread()) {
    return interaction.reply({
      content: 'Este comando/botão só pode ser usado dentro de um ticket (thread).',
      flags: MessageFlags.Ephemeral
    });
  }

  const produtoSugerido = ticketProdutoMap.get(interaction.channel.id) || '';

  const modal = new ModalBuilder()
    .setCustomId('modal:confirmar_venda')
    .setTitle('Finalizar Compra');

  const produtoInput = new TextInputBuilder()
    .setCustomId('produto')
    .setLabel('Nome do produto vendido')
    .setStyle(TextInputStyle.Short)
    .setValue(produtoSugerido)
    .setRequired(true);

  const quantidadeInput = new TextInputBuilder()
    .setCustomId('quantidade')
    .setLabel('Quantidade')
    .setStyle(TextInputStyle.Short)
    .setValue('1')
    .setRequired(true);

  const usuarioContaInput = new TextInputBuilder()
    .setCustomId('usuarioConta')
    .setLabel('Usuário/login da conta entregue (opcional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const cupomInput = new TextInputBuilder()
    .setCustomId('cupom')
    .setLabel('Cupom de desconto (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: BEMVINDO10')
    .setRequired(false);

  const referenciaInput = new TextInputBuilder()
    .setCustomId('referenciaImagem')
    .setLabel('📸 Foto de referência (URL, opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://i.imgur.com/...')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(produtoInput),
    new ActionRowBuilder().addComponents(quantidadeInput),
    new ActionRowBuilder().addComponents(usuarioContaInput),
    new ActionRowBuilder().addComponents(cupomInput),
    new ActionRowBuilder().addComponents(referenciaInput)
  );

  await interaction.showModal(modal);
}

// Chamado depois que a staff preenche o modal de finalizacao.
// Valida produto/cupom e mostra as opcoes de pagamento.
async function processarConfirmacaoVenda(interaction) {
  const store = loadStore(interaction.guildId);
  const produtoNome = interaction.fields.getTextInputValue('produto').trim();
  const quantidade = parseInt(interaction.fields.getTextInputValue('quantidade'), 10) || 1;
  const usuarioConta = interaction.fields.getTextInputValue('usuarioConta')?.trim() || null;
  const cupomCode = interaction.fields.getTextInputValue('cupom')?.trim() || null;
  const referenciaImagem = interaction.fields.getTextInputValue('referenciaImagem')?.trim() || null;

  const produto = store.sales.products.find(p => p.name.toLowerCase() === produtoNome.toLowerCase());

  if (!produto) {
    return interaction.reply({
      content: `Produto "${produtoNome}" não encontrado no catálogo. Confira o nome exato em /config > Vendas > Listar Produtos.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (quantidade <= 0) {
    return interaction.reply({ content: '❌ Quantidade inválida.', flags: MessageFlags.Ephemeral });
  }

  if (produto.stock < quantidade) {
    return interaction.reply({
      content: `❌ Estoque insuficiente. Restam ${produto.stock} unidade(s) de ${produto.name}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Aplica cupom se informado
  let discount = 0;
  if (cupomCode) {
    const resultado = aplicarCupom(store, cupomCode);
    if (!resultado.ok) {
      return interaction.reply({ content: `❌ Cupom: ${resultado.error}`, flags: MessageFlags.Ephemeral });
    }
    discount = calcularDesconto(resultado.cupom, produto.price * quantidade);
    discount = Math.round(discount * 100) / 100;
  }

  const initialValue = produto.price * quantidade;
  const finalValue = Math.max(0, initialValue - discount);

  // Guarda a sessao em memoria
  const sessaoId = generateId('sess_');
  sessaoVendaMap.set(sessaoId, {
    userId: interaction.channel.threadMetadata ? interaction.channel.threadMetadata.ownerId : null,
    threadId: interaction.channel.id,
    produtoId: produto.id,
    produtoName: produto.name,
    quantidade,
    initialValue,
    discount,
    finalValue,
    couponCode: cupomCode,
    usuarioConta,
    referenciaImagem
  });

  const saldo = getBalance(store, interaction.user.id);

  const embed = new EmbedBuilder()
    .setTitle('💳 Forma de pagamento')
    .setDescription(
      `**Produto:** ${produto.name} x${quantidade}\n` +
      (cupomCode ? `**Cupom:** \`${cupomCode}\` (desconto de R$ ${discount.toFixed(2)})\n` : '') +
      `**Valor inicial:** R$ ${initialValue.toFixed(2)}\n` +
      `**Valor final:** R$ ${finalValue.toFixed(2)}\n\n` +
      `💵 **Seu saldo:** R$ ${saldo.toFixed(2)}\n\n` +
      'Escolha a forma de pagamento:'
    )
    .setColor(store.color || '#5865F2');

  const row = new ActionRowBuilder();

  if (saldo >= finalValue) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:pagar_saldo:${sessaoId}`)
        .setLabel(`Pagar com Saldo (R$ ${finalValue.toFixed(2)})`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('💳')
    );
  } else if (saldo > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:pagar_saldo:${sessaoId}`)
        .setLabel(`Saldo (R$ ${saldo.toFixed(2)}) + Pix (R$ ${(finalValue - saldo).toFixed(2)})`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('💳')
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:pagar_pix:${sessaoId}`)
      .setLabel('Pix (pendente)')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🏦'),
    new ButtonBuilder()
      .setCustomId(`ticket:cancelar_sessao:${sessaoId}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️')
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
}

// Pagamento com saldo (parcial ou total)
async function pagarComSaldo(interaction, sessaoId) {
  const store = loadStore(interaction.guildId);
  const sessao = sessaoVendaMap.get(sessaoId);

  if (!sessao) {
    return interaction.reply({ content: '❌ Sessão de venda expirada. Inicie novamente com "Confirmar Venda".', flags: MessageFlags.Ephemeral });
  }

  const saldo = getBalance(store, interaction.user.id);
  if (saldo <= 0) {
    return interaction.reply({ content: '❌ Você não possui saldo.', flags: MessageFlags.Ephemeral });
  }

  const usarSaldo = Math.min(saldo, sessao.finalValue);
  const restante = Math.round((sessao.finalValue - usarSaldo) * 100) / 100;

  // Deduz o saldo usado
  addBalance(store, interaction.user.id, -usarSaldo);

  // Estoque e cupom so sao registrados quando a venda for 100% finalizada
  if (restante > 0) {
    // Venda parcial: o restante vai para pendencia Pix
    sessao.finalValue = restante;
    sessao.initialValue = restante;
    sessao.discount = 0;
    sessao.saldoUsado = usarSaldo;
    saveStore(interaction.guildId, store);
    return registrarPendente(interaction, store, sessao);
  }

  // Venda 100% paga com saldo
  const produto = store.sales.products.find(p => p.id === sessao.produtoId);
  if (produto) {
    produto.stock = Math.max(0, produto.stock - sessao.quantidade);
  }
  if (sessao.couponCode) registrarUso(store, sessao.couponCode);

  const compra = {
    id: generateId('compra_'),
    buyerId: sessao.userId || interaction.user.id,
    buyerTag: null,
    productId: sessao.produtoId,
    productName: sessao.produtoName,
    quantity: sessao.quantidade,
    initialValue: sessao.initialValue,
    discount: sessao.discount,
    finalValue: sessao.finalValue,
    couponCode: sessao.couponCode,
    paymentMethod: 'Saldo',
    accountUsername: sessao.usuarioConta,
    referenceImage: sessao.referenciaImagem,
    saldoUsado: usarSaldo,
    date: Date.now()
  };

  store.sales.history.push(compra);
  saveStore(interaction.guildId, store);
  sessaoVendaMap.delete(sessaoId);

  await finalizarCompra(interaction, store, compra);
}

// Pagamento via Pix (vira pendente)
async function pagarComPix(interaction, sessaoId) {
  const store = loadStore(interaction.guildId);
  const sessao = sessaoVendaMap.get(sessaoId);

  if (!sessao) {
    return interaction.reply({ content: '❌ Sessão de venda expirada. Inicie novamente com "Confirmar Venda".', flags: MessageFlags.Ephemeral });
  }

  sessaoVendaMap.delete(sessaoId);
  await registrarPendente(interaction, store, sessao);
}

// Cancelou a sessao
async function cancelarSessao(interaction, sessaoId) {
  sessaoVendaMap.delete(sessaoId);
  await interaction.update({
    content: '✖️ Finalização de venda cancelada.',
    embeds: [],
    components: []
  });
}

async function fecharTicket(interaction) {
  if (!interaction.channel.isThread()) {
    return interaction.reply({ content: 'Isso só funciona dentro de um ticket.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({ content: 'Fechando ticket em 5 segundos...' });
  setTimeout(() => {
    interaction.channel.setArchived(true).catch(() => {});
  }, 5000);
}

module.exports = {
  abrirTicket,
  confirmarVenda,
  processarConfirmacaoVenda,
  pagarComSaldo,
  pagarComPix,
  cancelarSessao,
  fecharTicket
};