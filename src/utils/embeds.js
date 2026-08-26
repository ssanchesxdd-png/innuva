// src/utils/embeds.js
// Todos os visuais sao Components V2 (Container + TextDisplay + Section + MediaGallery).
// A cor de destaque herda de /config > Personalizacao e as imagens de /config > Imagens.

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

function accent(store) {
  return parseInt((store.color || '#5865F2').replace('#', ''), 16);
}

function galeria(url) {
  return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url));
}

// Recibo publico de venda (log #auto): sem foto — foto so no botao "Referencia"
function publicSaleContainer(store, compra) {
  const container = new ContainerBuilder()
    .setAccentColor(accent(store))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${compra.productName}**`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<@${compra.buyerId}>\n` +
        `${new Date(compra.date).toLocaleString('pt-BR')}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `🪪 **Nick:** ${compra.accountUsername || 'Não informado'}\n` +
        `🎮 **Produto:** ${compra.productName} x${compra.quantity}\n` +
        `💰 **Valor:** R$ ${compra.finalValue.toFixed(2)}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`publico:comprar_tambem:${compra.id}`)
          .setLabel('Comprar também')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🛒'),
        new ButtonBuilder()
          .setCustomId(`publico:referencia:${compra.id}`)
          .setLabel('Referência')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📄')
      )
    );

  return container;
}

// Resposta do botao "Referencia" — ephemeral, mostra a foto se houver
function referenciaContainer(store, compra) {
  const container = new ContainerBuilder()
    .setAccentColor(accent(store))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**📄 Referência da compra**\n\n` +
        `🎮 **Produto:** ${compra.productName}\n` +
        `🧾 **ID da Compra:** \`${compra.id}\`\n` +
        `🔑 **Status:** entrega confirmada ✔️\n\n` +
        `*(visível somente para você)*`
      )
    );

  if (compra.referenceImage) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addMediaGalleryComponents(galeria(compra.referenceImage));
  }

  return container;
}

// Log privado da staff — rows opcionais (botoes de pos-venda)
function privateLogContainer(store, title, description, rows = []) {
  const container = new ContainerBuilder()
    .setAccentColor(accent(store))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${title}**\n\n${description}`)
    );

  if (store.images?.logs) {
    container.addMediaGalleryComponents(galeria(store.images.logs));
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  for (const row of rows) container.addActionRowComponents(row);

  return container;
}

// Painel de ticket: seletor de tipo dentro do container
function ticketPanelContainer(store, selectRow) {
  const container = new ContainerBuilder()
    .setAccentColor(accent(store));

  const texto =
    `**🎫 Suporte — ${store.storeName}**\n\n` +
    'Precisa de ajuda? Selecione o tipo de atendimento abaixo e um canal privado será aberto só para você e nossa equipe.';

  if (store.logoUrl) {
    container.addSectionComponents(
      new SectionBuilder({
        components: [new TextDisplayBuilder().setContent(texto)],
        accessory: new ThumbnailBuilder({ media: { url: store.logoUrl } })
      })
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(texto));
  }

  if (store.images?.ticket) {
    container.addMediaGalleryComponents(galeria(store.images.ticket));
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(selectRow);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('faq:abrir')
        .setLabel('Dúvidas Frequentes')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❓')
      )
    )
  return container;
}

// Lista de cupons cadastrados (/cupom listar)
function couponListContainer(store) {
  let descricao;

  if (store.coupons.length === 0) {
    descricao = 'Nenhum cupom cadastrado ainda. Use `/cupom criar`.';
  } else {
    const linhas = store.coupons.map(c => {
      const desconto = c.type === 'percent' ? `${c.value}%` : `R$ ${c.value.toFixed(2)}`;
      const usos = c.maxUses > 0 ? `${c.uses}/${c.maxUses}` : `${c.uses}/∞`;
      const expira = c.expiresAt ? ` · expira ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}` : '';
      const valido = !c.expiresAt || c.expiresAt > Date.now();
      return `${valido ? '✅' : '❌'} \`${c.code}\` — ${desconto}\n> Usos: ${usos}${expira}`;
    });
    descricao = linhas.join('\n\n');
  }

  return new ContainerBuilder()
    .setAccentColor(accent(store))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**🎟️ Cupons Cadastrados**\n\n${descricao}`)
    );
}

module.exports = {
  publicSaleContainer,
  referenciaContainer,
  privateLogContainer,
  ticketPanelContainer,
  couponListContainer
};
