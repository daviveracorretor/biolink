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

1. Crie um projeto Supabase e uma tabela `properties` com colunas: `id` (uuid, primary key), `title` (text), `description` (text), `category` (text), `region` (text), `price` (numeric), `area` (numeric), `bedrooms` (integer), `suites` (integer), `bathrooms` (integer), `parking` (integer), `features` (jsonb), `payment` (text), `code` (text), `status` (text), `featured` (boolean), `photos` (jsonb), `cover` (text), `created_at` (timestamptz default now()).
2. Crie um bucket de Storage público para as fotos (ou ajuste as políticas e o código se preferir acesso privado). Restrinja upload e exclusão à conta autenticada de administrador.
3. Ative Row Level Security. Permita leitura pública somente dos anúncios publicados/reservados/vendidos, e operações de escrita apenas para usuários autenticados com função administrativa. Não habilite escrita pública.
4. Cadastre o usuário administrador em Supabase Auth. Configure `url`, `anonKey` (chave pública/publishable), `table` e `bucket` em `config.js`. A chave pública pode estar no site; nunca publique `service_role`, senha ou chave privilegiada.
5. Faça login pelo painel de gerenciamento. O painel suporta rascunhos, publicação, reserva, venda, edição, exclusão confirmada, múltiplas fotos e escolha da capa (a primeira foto é a capa). A pré-visualização permite revisar antes de salvar.

O código envia e consulta dados diretamente pela API REST e Storage do Supabase. A segurança depende das políticas RLS e Storage configuradas no projeto; não publique até validar essas políticas. Os formulários de busca de compradores e captação são atalhos de WhatsApp, pois o GitHub Pages não pode transmitir formulários sem serviço externo. Analytics opcional aceita POST JSON no endpoint definido em `analyticsEndpoint`.

## Compartilhamento e acessibilidade

Cada imóvel tem URL com fragmento próprio (`#imovel-ID`), botão de copiar e compartilhamento nativo quando disponível. Tema, filtros, modal e galeria funcionam no navegador; o site respeita redução de movimento. Os links para fontes do Google são apenas melhoria tipográfica: fontes locais de reserva mantêm a página legível sem conexão externa.
