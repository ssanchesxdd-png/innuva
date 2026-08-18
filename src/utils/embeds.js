// src/utils/embeds.js
// Funcoes para criar embeds com visual de loja (banner, bullets, footer com marca).
// Todas as embeds herdam a cor configurada em /config > Personalizacao,
// e as imagens por categoria definidas em /config > Imagens das Embeds.

const { EmbedBuilder } = require('discord.js');

function baseEmbed(store) {
  return new EmbedBuilder()
    .setColor(store.color || '#5865F2')
    .setFooter({ text: store.storeName || 'Loja', iconURL: store.logoUrl || undefined })
    .setTimestamp();
}

// Embed de UM produto especifico, estilo "card de produto".
// Usa a imagem do proprio produto, ou a padrao da categoria se nao tiver.
function productCardEmbed(store, produto) {
  const embed = baseEmbed(store)
    .setTitle(`🎮 ${produto.name}`)
    .setDescription(
      (produto.description ? `${produto.description}\n\n` : '') +
      `💰 **Valor à vista:** R$ ${produto.price.toFixed(2)}\n` +
      `📦 **Restam:** ${produto.stock} unidade(s)`
    );

  if (produto.imageUrl) embed.setImage(produto.imageUrl);
  else if (store.images?.product) embed.setImage(store.images.product);
  if (store.logoUrl) embed.setThumbnail(store.logoUrl);

  return embed;
}

// Lista resumida de produtos de um jogo (fallback/visao geral)
function productListEmbed(store, game) {
  const produtos = store.sales.products.filter(p => p.game === game && p.stock > 0);

  const embed = baseEmbed(store)
    .setTitle(`🛒 ${store.storeName} — ${game}`)
    .setDescription(
      produtos.length > 0
        ? 'Confira as contas disponíveis abaixo e clique em "Comprar" para negociar.'
        : 'Nenhuma conta disponível neste momento. Volte mais tarde!'
    );

  for (const p of produtos) {
    embed.addFields({
      name: `${p.name} — R$ ${p.price.toFixed(2)}`,
      value: `📦 Estoque: ${p.stock} unidade(s)`,
      inline: false
    });
  }

  return embed;
}

// Embed de log publico (venda concluida) — recibo "Compra Aprovada"
// no estilo da referencia: Resumo do Pedido + Informacoes Financeiras + Produto.
function publicSaleEmbed(store, compra) {
  const embed = baseEmbed(store)
    .setTitle('✅ Compra Aprovada')
    .setDescription(
      `**Resumo do Pedido:**\n` +
      `▫️ **Comprador:** <@${compra.buyerId}>\n` +
      `▫️ **ID da Compra:** \`${compra.id}\`\n` +
      `▫️ **Feita em:** ${new Date(compra.date).toLocaleString('pt-BR')}\n\n` +
      `**Informações Financeiras:**\n` +
      `▫️ **Valor Inicial:** R$ ${compra.initialValue.toFixed(2)}\n` +
      `▫️ **Valor com Desconto:** ${compra.discount > 0 ? '−R$ ' + compra.discount.toFixed(2) : 'R$ 0,00'}\n` +
      `▫️ **Valor Final:** **R$ ${compra.finalValue.toFixed(2)}**\n\n` +
      `**Produto Comprado:**\n` +
      `▫️ 🎮 ${compra.productName} x${compra.quantity}\n\n` +
      'Obrigado pela compra! ❤️'
    );

  // Foto de referencia adicionada pela staff ao finalizar a compra
  if (compra.referenceImage) embed.setImage(compra.referenceImage);
  if (store.logoUrl) embed.setThumbnail(store.logoUrl);

  return embed;
}

// Resposta ephemeral do botao "Referencia" — so quem clicou ve
function referenciaEmbed(store, compra) {
  const embed = baseEmbed(store)
    .setTitle('📄 Referência da compra')
    .setDescription(
      `🎮 **Produto:** ${compra.productName}\n` +
      `🧾 **ID da Compra:** \`${compra.id}\`\n` +
      `🔑 **Status:** entrega confirmada ✔️\n\n` +
      `*(visível somente para você)*`
    );

  if (compra.referenceImage) embed.setImage(compra.referenceImage);
  if (store.logoUrl) embed.setThumbnail(store.logoUrl);

  return embed;
}

// Embed de log privado (staff)
function privateLogEmbed(store, title, description) {
  const embed = baseEmbed(store).setTitle(title).setDescription(description);
  if (store.images?.logs) embed.setImage(store.images.logs);
  return embed;
}

// Embed do painel de ticket/suporte
function ticketPanelEmbed(store) {
  const embed = baseEmbed(store)
    .setTitle(`🎫 Suporte — ${store.storeName}`)
    .setDescription('Clique no botão abaixo para abrir um atendimento privado com a nossa equipe.');
  if (store.images?.ticket) embed.setImage(store.images.ticket);
  if (store.logoUrl) embed.setThumbnail(store.logoUrl);
  return embed;
}

// Embed da venda pendente (aguardando pagamento), postada dentro da thread do ticket
function pendingCardEmbed(store, pending) {
  const embed = baseEmbed(store)
    .setTitle('⏳ Venda pendente de pagamento')
    .setDescription(
      `🎮 **Produto:** ${pending.productName}\n` +
      `👤 **Cliente:** <@${pending.userId}>\n` +
      `💵 **Valor:** R$ ${pending.finalValue.toFixed(2)}\n` +
      (pending.couponCode ? `🎟️ **Cupom:** \`${pending.couponCode}\`\n` : '') +
      (store.pixKey ? `🏦 **Chave Pix:** \`${store.pixKey}\`\n` : '⚠️ **Chave Pix não configurada!** Use /config > Vendas > Chave Pix.\n') +
      `⏰ **Expira em:** ${new Date(pending.expiresAt).toLocaleTimeString('pt-BR')}`
    );
  if (store.logoUrl) embed.setThumbnail(store.logoUrl);
  return embed;
}

// Lista simples de produtos cadastrados (usada em /config > Vendas > Listar Produtos)
function productManageListEmbed(store) {
  const embed = baseEmbed(store).setTitle('📋 Produtos Cadastrados');

  if (store.sales.products.length === 0) {
    embed.setDescription('Nenhum produto cadastrado ainda.');
    return embed;
  }

  for (const p of store.sales.products) {
    embed.addFields({
      name: `${p.name} (${p.game})`,
      value: `💰 R$ ${p.price.toFixed(2)} · 📦 Estoque: ${p.stock} · ID: \`${p.id}\``,
      inline: false
    });
  }

  return embed;
}

// Lista de cupons cadastrados (usada em /cupom listar)
function couponListEmbed(store) {
  const embed = baseEmbed(store).setTitle('🎟️ Cupons Cadastrados');

  if (store.coupons.length === 0) {
    embed.setDescription('Nenhum cupom cadastrado ainda. Use `/cupom criar`.');
    return embed;
  }

  for (const c of store.coupons) {
    const desconto = c.type === 'percent' ? `${c.value}%` : `R$ ${c.value.toFixed(2)}`;
    const usos = c.maxUses > 0 ? `${c.uses}/${c.maxUses}` : `${c.uses}/∞`;
    const expira = c.expiresAt ? ` · expira ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}` : '';
    const valido = !c.expiresAt || c.expiresAt > Date.now();
    embed.addFields({
      name: `${valido ? '✅' : '❌'} \`${c.code}\` — ${desconto}`,
      value: `Usos: ${usos}${expira}`,
      inline: false
    });
  }

  return embed;
}

module.exports = {
  baseEmbed,
  productCardEmbed,
  productListEmbed,
  publicSaleEmbed,
  referenciaEmbed,
  privateLogEmbed,
  ticketPanelEmbed,
  pendingCardEmbed,
  productManageListEmbed,
  couponListEmbed
};