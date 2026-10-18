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

O projeto Supabase `Davi Vera Linkbio` já está conectado. A tabela `properties`, o bucket `property-photos` e as políticas de Row Level Security foram criados. A conta administradora autorizada é a do UUID `d4f4490d-96f2-406b-bced-6f0a27d31116`; novos cadastros públicos estão desativados.

1. Abra o convite enviado ao e-mail administrador, confirme o endereço e defina uma senha no Supabase. Para trocar uma senha esquecida, use **Authentication → Users → seu usuário → Send password recovery**; o link abre uma tela do próprio site para cadastrar a nova senha.
2. Acesse o [site publicado](https://daviveracorretor.github.io/biolink/), abra **Área de gerenciamento** e escolha **Entrar como administrador**.
3. Informe o e-mail e a senha definidos no convite. O formulário de imóveis aparecerá após a autenticação.
4. Preencha os dados, selecione as fotos, escolha o status e clique em **Salvar imóvel**. Use **Publicado** para exibir o imóvel no catálogo.

O UUID é um identificador público, não uma credencial. A chave `anonKey` em `config.js` é a chave publishable, destinada ao navegador; ela não concede privilégios administrativos por si só. As políticas RLS do banco e Storage limitam inserção, edição, exclusão e upload ao UUID do administrador. O próprio código do navegador pode ser lido por qualquer visitante: não coloque `service_role`, senhas ou outras chaves secretas no repositório.

### Segurança e arquivos `.env`

Este site é estático e publicado pelo GitHub Pages. Portanto, qualquer valor incluído no HTML, JavaScript, arquivos gerados ou requisições do navegador fica visível ao público. Um `.env` não esconderia valores usados pelo front-end; variáveis `.env` só protegem segredos quando lidas exclusivamente por um servidor ou durante um build que não publique o segredo no artefato final. O `.gitignore` ignora arquivos `.env` locais para reduzir o risco de adicioná-los ao Git por engano.

Na revisão do projeto, a configuração contém somente a chave publishable do Supabase, o endereço do projeto e IDs públicos; não deve conter `service_role` nem senha. Telefone e Instagram são informações de contato públicas do site. A tela de login pede a senha em um campo mascarado; o acesso efetivo é controlado no Supabase por RLS, não pelo botão ou pelo UUID no JavaScript. As imagens do bucket `property-photos` e imóveis publicados são públicos por decisão de exibição do catálogo; não envie fotos ou dados privados para lá. Mantenha novos cadastros públicos desativados, proteja a conta Supabase com senha exclusiva e autenticação multifator, e nunca compartilhe links de recuperação ou tokens de sessão.

Para reconstruir este backend, execute `supabase/setup.sql` no SQL Editor e mantenha o UUID alinhado ao `adminUserId` em `config.js`.

O painel suporta rascunho, publicação, reserva, venda, edição, exclusão confirmada, múltiplas fotos e escolha da capa. Para corrigir um anúncio, entre na área de gerenciamento e clique em **Editar** na linha do imóvel; o formulário identifica o anúncio em edição e permite salvar as alterações ou cancelar. Preço e área aceitam casas decimais. Imóveis na planta podem ter várias opções de planta com quartos, suítes e área; esses campos são opcionais. As opções são salvas junto aos diferenciais no campo JSON já existente, sem exigir alteração da tabela. A pré-visualização permite revisar antes de salvar. Essa configuração autoriza um único usuário. Para trocar o administrador, substitua o UUID nas políticas do SQL e em `config.js`.

O código envia e consulta dados diretamente pela API REST e Storage do Supabase. Não libere escrita pública nem use a chave `service_role` no site. Os formulários de busca de compradores e captação são atalhos de WhatsApp, pois o GitHub Pages não pode transmitir formulários sem serviço externo. Analytics opcional aceita POST JSON no endpoint definido em `analyticsEndpoint`.

## Fonte

O site usa Satoshi como fonte principal em todos os textos, incluindo o nome. A fonte é carregada do Fontshare; se o serviço estiver indisponível, o navegador usa Arial como alternativa. Consulte a [licença da fonte Satoshi no Fontshare](https://www.fontshare.com/fonts/satoshi).

## Compartilhamento e acessibilidade

Cada imóvel tem URL com fragmento próprio (`#imovel-ID`), botão de copiar e compartilhamento nativo quando disponível. Tema, filtros, modal e galeria funcionam no navegador; o site respeita redução de movimento. Os links para fontes do Google são apenas melhoria tipográfica: fontes locais de reserva mantêm a página legível sem conexão externa.
