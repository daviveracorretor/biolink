# Davi Vera · Link na bio imobiliário

Site estático em HTML, CSS e JavaScript puro, pronto para GitHub Pages. Não requer build nem instalação.

## Personalizar

Edite `config.js` para informar o WhatsApp no formato internacional (DDI + DDD + número), o Instagram e o caminho da foto de perfil. A foto deve ser adicionada ao repositório, por exemplo em `assets/davi-vera.jpg`. O site começa sem anúncios porque nenhum imóvel foi fornecido.

Os textos, categorias, chamada de simulação, URL e visibilidade dessa chamada também estão no `config.js`. Os links de contato usam mensagens pré-preenchidas.

## Publicar no GitHub Pages

1. Envie os arquivos `index.html`, `style.css`, `script.js`, `config.js`, `.github/workflows/pages.yml` e este README para a branch `main`.
2. No GitHub, abra **Settings → Pages** e em **Build and deployment** selecione **GitHub Actions** como fonte.
3. Aguarde a ação **Publish static site to GitHub Pages** e abra a URL indicada pelo GitHub Pages. Atualizações na branch `main` são publicadas automaticamente.

## Catálogo e painel administrativo opcionais (Supabase)

Sem configuração do Supabase, o catálogo mostra o estado vazio e a área de gerenciamento explica o que falta. O catálogo usa `localStorage` apenas para a preferência visual; imóveis nunca são tratados como dados locais persistentes.

1. Crie um projeto Supabase e um usuário para você em **Authentication → Users**. Desative novos cadastros públicos em **Authentication → Settings**, pois só você deve ter acesso administrativo.
2. Copie o UUID do seu usuário. No arquivo `supabase/setup.sql`, substitua todas as ocorrências de `OWNER_AUTH_USER_UUID` pelo UUID real e execute o SQL Editor do Supabase.
3. Em `config.js`, preencha `url`, `anonKey` (chave pública/publishable) e `adminUserId` com o mesmo UUID. Mantenha `table` como `properties` e `bucket` como `property-photos`, ou ajuste ambos no SQL também.
4. Publique a alteração de `config.js`. O UUID é um identificador público, não uma credencial; nunca coloque `service_role`, senhas ou chaves privilegiadas no repositório.
5. Entre em **Área de gerenciamento** no site. O formulário só aparece após Supabase Auth confirmar o UUID autorizado. A proteção real também é aplicada por Row Level Security: visitantes leem anúncios públicos, mas somente o UUID indicado no SQL pode criar, editar, excluir anúncios ou enviar/remover fotos.

O painel suporta rascunho, publicação, reserva, venda, edição, exclusão confirmada, múltiplas fotos e escolha da capa (a primeira foto é a capa). A pré-visualização permite revisar antes de salvar. Essa configuração autoriza um único usuário. Para trocar o administrador, substitua o UUID nas políticas do SQL e em `config.js`.

O código envia e consulta dados diretamente pela API REST e Storage do Supabase. Não libere escrita pública nem use a chave `service_role` no site. Os formulários de busca de compradores e captação são atalhos de WhatsApp, pois o GitHub Pages não pode transmitir formulários sem serviço externo. Analytics opcional aceita POST JSON no endpoint definido em `analyticsEndpoint`.

## Fonte

O site usa Satoshi como fonte principal em todos os textos, incluindo o nome. A fonte é carregada do Fontshare; se o serviço estiver indisponível, o navegador usa Arial como alternativa. Consulte a [licença da fonte Satoshi no Fontshare](https://www.fontshare.com/fonts/satoshi).

## Compartilhamento e acessibilidade

Cada imóvel tem URL com fragmento próprio (`#imovel-ID`), botão de copiar e compartilhamento nativo quando disponível. Tema, filtros, modal e galeria funcionam no navegador; o site respeita redução de movimento. Os links para fontes do Google são apenas melhoria tipográfica: fontes locais de reserva mantêm a página legível sem conexão externa.
