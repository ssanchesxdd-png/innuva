// src/handlers/publicar.js
// Sincroniza os cards de produto (Container V2) nos canais de envio configurados:
// - envia card novo se ainda nao existir naquele canal
// - edita o card existente (preco, estoque, imagem, cor atualizados)
// - deleta cards de produtos que foram removidos da loja
// Resultado: o canal de vendas fica sempre espelhando o estoque, e o cliente
// so precisa clicar em "🛒 Comprar" — sem digitar nenhum comando.

const { loadStore, saveStore } = require('../storage');
const { V2_FLAGS, montarContainerProduto } = require('../utils/v2');

// Publica/atualiza todos os cards nos canais de envio.
// Opcoes:
//   repostar: true  -> apaga os cards antigos e publica novos (usado no reenvio
//                      programado, pra mensagem aparecer no topo do canal)
// Retorna { enviados, editados, removidos } ou null se nao ha canais configurados.
async function publicarCards(guild, { repostar = false } = {}) {
  const store = loadStore(guild.id);
  const canais = store.sales.sendChannelIds || [];
  const produtos = store.sales.products;
  const registros = store.sales.cardMessages || (store.sales.cardMessages = []);

  if (canais.length === 0) return null;

  let enviados = 0;
  let editados = 0;
  let removidos = 0;

  const montar = (produto) => montarContainerProduto(store, produto, {
    titulo: `🎮 ${produto.name}`,
    info:
      (produto.description ? `${produto.description}\n\n` : '') +
      `💰 **Valor à vista:** R$ ${produto.price.toFixed(2)}\n` +
      `📦 **Restam:** ${produto.stock} unidade(s)`,
    divAcima: true,
    divAbaixo: true
  });

  for (const canalId of canais) {
    const canal = await guild.channels.fetch(canalId).catch(err => { console.log('[publicar] canal ' + canalId + ' FALHOU: ' + (err.code || err.message)); return null; });
    console.log('[publicar] canal ' + canalId + ' ok (' + canal.name + ')');
    if (!canal) continue;

    for (const produto of produtos) {
      const reg = registros.find(r => r.productId === produto.id && r.channelId === canalId);
      const container = montar(produto);

      if (reg && repostar) {
        // Reenvio programado: apaga o card antigo e publica um novo no topo
        const antiga = await canal.messages.fetch(reg.messageId).catch(() => null);
        if (antiga) await antiga.delete().catch(() => {});
        const nova = await canal.send({ components: [container], flags: V2_FLAGS }).catch(err => { console.log('[publicar] falha ao reenviar: ' + (err.code || '') + ' ' + (err.message || '')); return null; });
        if (nova) {
          reg.messageId = nova.id;
          enviados++;
        }
        continue;
      }

      if (reg) {
        const msg = await canal.messages.fetch(reg.messageId).catch(() => null);
        if (msg) {
          await msg.edit({ components: [container], flags: V2_FLAGS }).catch(() => {});
          editados++;
          continue;
        }
        // Card apagado manualmente no canal: envia de novo
        const nova = await canal.send({ components: [container], flags: V2_FLAGS }).catch(err => { console.log('[publicar] falha ao enviar: ' + (err.code || '') + ' ' + (err.message || '')); return null; });
        if (nova) {
          reg.messageId = nova.id;
          enviados++;
        }
      } else {
        const msg = await canal.send({ components: [container], flags: V2_FLAGS }).catch(err => { console.log('[publicar] falha ao enviar: ' + (err.code || '') + ' ' + (err.message || '')); return null; });
        if (msg) {
          registros.push({ productId: produto.id, channelId: canalId, messageId: msg.id });
          enviados++;
        }
      }
    }
  }

  // Cards de produtos que nao existem mais: deleta e desregistra
  for (const reg of [...registros]) {
    if (!produtos.some(p => p.id === reg.productId)) {
      const canal = await guild.channels.fetch(reg.channelId).catch(() => null);
      if (canal) {
        const msg = await canal.messages.fetch(reg.messageId).catch(() => null);
        if (msg) {
          await msg.delete().catch(() => {});
          removidos++;
        }
      }
      registros.splice(registros.indexOf(reg), 1);
    }
  }

  saveStore(guild.id, store);
  return { enviados, editados, removidos };
}

module.exports = { publicarCards };
