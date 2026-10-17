(() => {
  'use strict';
  const config = window.SITE_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const state = { properties: [], category: config.categories?.[0] || 'Todos', gallery: [], galleryIndex: 0, pendingPhotos: [], user: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasSupabase = () => Boolean(config.supabase?.url && config.supabase?.anonKey);
  const wa = (message = 'Olá, Davi! Gostaria de conversar sobre imóveis em Cascavel.') => config.whatsapp ? `https://wa.me/${encodeURIComponent(config.whatsapp)}?text=${encodeURIComponent(message)}` : '#admin';
  const money = n => n ? Number(n).toLocaleString('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 }) : 'Consulte condições';

  function initTheme() {
    const saved = localStorage.getItem('dv-theme');
    document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const button = $('#theme-toggle');
    const updateButton = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      button.setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
      button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
      button.querySelector('span').textContent = dark ? '☀' : '☾';
    };
    updateButton();
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; localStorage.setItem('dv-theme', next);
      updateButton();
    });
  }
  function setupProfile() {
    if (config.profileImage) $('#avatar').innerHTML = `<img src="${esc(config.profileImage)}" alt="Davi Vera" onerror="this.remove()">`;
    const insta = $('#instagram-link');
    if (config.instagram) { insta.href = config.instagram; insta.target = '_blank'; insta.rel = 'noopener'; } else insta.hidden = true;
    ['whatsapp-link','simulate-link','empty-whatsapp','buyer-link','owner-link'].forEach(id => {
      const el = document.getElementById(id);
      const text = id === 'owner-link' ? 'Olá, Davi! Tenho um imóvel em Cascavel e gostaria de conversar sobre anunciar.' : id === 'simulate-link' ? 'Olá, Davi! Gostaria de fazer uma simulação de crédito imobiliário.' : undefined;
      el.href = wa(text); if (!config.whatsapp) el.title = 'Configure o WhatsApp em config.js';
    });
    if (config.spotlight?.visible === false) $('#spotlight').hidden = true;
    else { $('#spotlight h2').textContent = config.spotlight?.title || $('#spotlight h2').textContent; $('#spotlight .spotlight-description').textContent = config.spotlight?.description || $('#spotlight .spotlight-description').textContent; $('#simulate-link').textContent = config.spotlight?.button || 'Fazer simulação'; }
    $('#year').textContent = new Date().getFullYear();
  }
  function filteredProperties() {
    const search = $('#search-input').value.trim().toLocaleLowerCase('pt-BR');
    const region = $('#region-filter').value.trim().toLocaleLowerCase('pt-BR');
    const price = Number($('#price-filter').value); const rooms = Number($('#rooms-filter').value);
    return state.properties.filter(p => p.status === 'published' || ['reserved','sold'].includes(p.status))
      .filter(p => state.category === 'Todos' || p.category === state.category)
      .filter(p => !search || `${p.title} ${p.region} ${p.description}`.toLocaleLowerCase('pt-BR').includes(search))
      .filter(p => !region || String(p.region || '').toLocaleLowerCase('pt-BR').includes(region))
      .filter(p => !price || !p.price || Number(p.price) <= price)
      .filter(p => !rooms || Number(p.bedrooms || 0) >= rooms);
  }
  function renderCategories() {
    const host = $('#category-filters');
    host.innerHTML = [...(config.categories || []), 'Todos'].map(c => `<button class="category-chip ${state.category === c ? 'active':''}" type="button" data-category="${esc(c)}">${esc(c)}</button>`).join('');
    host.onclick = e => { const b = e.target.closest('[data-category]'); if (b) { state.category = b.dataset.category; renderCategories(); renderProperties(); } };
    const select = $('#property-form select[name="category"]'); if (select) select.innerHTML = (config.categories || []).map(c => `<option>${esc(c)}</option>`).join('');
  }
  function renderProperties() {
    const list = filteredProperties(); const grid = $('#property-grid');
    $('#listing-count').textContent = `${list.length} ${list.length === 1 ? 'imóvel' : 'imóveis'}`;
    $('#empty-state').hidden = list.length > 0; grid.innerHTML = list.map(p => {
      const cover = p.photos?.find(x => x.path === p.cover)?.url || p.photos?.[0]?.url || p.cover_url || '';
      const tags = [p.featured ? '<span class="badge">DESTAQUE</span>':'', p.status === 'reserved' ? '<span class="badge status">RESERVADO</span>':'', p.status === 'sold' ? '<span class="badge status">VENDIDO</span>':''].join('');
      const facts = [p.bedrooms ? `${esc(p.bedrooms)} quartos`:'', p.area ? `${esc(p.area)} m²`:'', p.parking ? `${esc(p.parking)} vagas`:'' ].filter(Boolean).join(' · ');
      return `<article class="property-card" tabindex="0" role="button" data-id="${esc(p.id)}"><div class="property-image">${cover ? `<img src="${esc(cover)}" alt="${esc(p.title)}" loading="lazy">`:''}<div class="property-badges">${tags}</div></div><div class="property-copy"><p class="eyebrow">${esc(p.category || 'IMÓVEL')}</p><h3>${esc(p.title)}</h3><p class="property-region">${esc(p.region || 'Cascavel, PR')}</p><p class="property-price">${money(p.price)}</p>${facts ? `<p class="property-meta">${facts}</p>`:''}</div></article>`;
    }).join('');
    $$('.property-card', grid).forEach(card => { card.onclick = () => openProperty(card.dataset.id); card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProperty(card.dataset.id); } }; });
  }
  async function track(id) { if (!config.analyticsEndpoint) return; try { await fetch(config.analyticsEndpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event:'property_view', property_id:id, timestamp:new Date().toISOString()}) }); } catch {} }
  function openProperty(id) {
    const p = state.properties.find(x => String(x.id) === String(id)); if (!p) return;
    const photos = p.photos?.map(x => x.url).filter(Boolean) || (p.cover_url ? [p.cover_url] : []);
    state.gallery = photos; state.galleryIndex = 0;
    const facts = [['Área',p.area && `${p.area} m²`],['Quartos',p.bedrooms],['Suítes',p.suites],['Banheiros',p.bathrooms],['Vagas',p.parking]].filter(x=>x[1]);
    const url = new URL(location.href); url.hash = `imovel-${encodeURIComponent(p.id)}`;
    const contact = wa(`Olá, Davi! Tenho interesse no imóvel ${p.title}${p.code ? ` (código ${p.code})`:''}.`);
    $('#modal-content').innerHTML = `<div class="modal-gallery">${photos.map((src,i)=>`<img src="${esc(src)}" alt="${esc(p.title)} — foto ${i+1}" data-photo-index="${i}" loading="lazy">`).join('')}</div><div class="modal-copy"><p class="eyebrow">${esc(p.category || '')} · ${esc(p.region || 'Cascavel, PR')}</p><h2>${esc(p.title)}</h2><p class="modal-price">${money(p.price)}</p>${p.code ? `<p>Código do anúncio: ${esc(p.code)}</p>`:''}<div class="modal-facts">${facts.map(x=>`<span>${esc(x[0])}: ${esc(x[1])}</span>`).join('')}</div><p>${esc(p.description || '')}</p>${p.features?.length ? `<h3>Diferenciais</h3><p>${esc(Array.isArray(p.features) ? p.features.join(' · ') : p.features)}</p>`:''}${p.payment ? `<h3>Condições de pagamento</h3><p>${esc(p.payment)}</p>`:''}<div class="share-actions"><a class="button button-primary" href="${esc(contact)}" ${config.whatsapp?'target="_blank" rel="noopener"':''}>Falar sobre este imóvel ↗</a><button class="button button-secondary" id="copy-property-link">Copiar link</button><button class="button button-secondary" id="share-property">Compartilhar</button></div></div>`;
    $$('.modal-gallery img').forEach(img => img.onclick = () => showLarge(Number(img.dataset.photoIndex)));
    $('#copy-property-link').onclick = async () => { await navigator.clipboard.writeText(url.href); $('#copy-property-link').textContent = 'Link copiado'; };
    $('#share-property').onclick = async () => { if (navigator.share) await navigator.share({title:p.title,url:url.href}); else { await navigator.clipboard.writeText(url.href); $('#share-property').textContent = 'Link copiado'; } };
    $('#property-modal').showModal(); history.replaceState(null,'',url); track(p.id);
  }
  function showLarge(index) { if (!state.gallery.length) return; state.galleryIndex = (index + state.gallery.length) % state.gallery.length; $('#large-image').src = state.gallery[state.galleryIndex]; $('#gallery-count').textContent = `${state.galleryIndex+1} / ${state.gallery.length}`; $('#image-modal').showModal(); }
  function authHeaders() { return {'apikey':config.supabase.anonKey, 'Authorization':`Bearer ${state.user?.access_token || config.supabase.anonKey}`, 'Content-Type':'application/json'}; }
  async function api(path, options={}) { const r=await fetch(`${config.supabase.url.replace(/\/$/,'')}/rest/v1/${path}`,{...options,headers:{...authHeaders(),...(options.headers||{})}}); if(!r.ok) throw new Error((await r.text()).slice(0,350)); return r.status===204 ? null : r.json(); }
  function setAdminStatus(text, error=false) { const e=$('#admin-status'); e.textContent=text; e.style.color=error?'#b2483c':''; }
  function mediaUrl(path) { return `${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/public/${config.supabase.bucket}/${path}`; }
  async function loadCatalog() {
    if (!hasSupabase()) { state.properties=[]; renderProperties(); setAdminStatus('O catálogo ainda não está conectado. Para publicar imóveis, configure o Supabase, o ID da sua conta administradora e as políticas de acesso descritas no README.'); return; }
    try { state.properties=await api(`${encodeURIComponent(config.supabase.table)}?select=*&order=created_at.desc`) || []; setAdminStatus(state.user ? `Conectado como ${state.user.email}.` : 'Catálogo conectado. Entre como administrador para gerenciar anúncios.'); }
    catch(e) { state.properties=[]; setAdminStatus(`Não foi possível carregar o catálogo. Confira tabela, políticas de leitura e conexão. ${e.message}`,true); }
    renderProperties(); renderAdmin();
  }
  function login() { const dialog=$('#admin-login-dialog'); $('#admin-login-error').textContent=''; dialog.showModal(); $('#admin-login-form').elements.email.focus(); }
  async function submitAdminLogin(event) { event.preventDefault(); const form=event.currentTarget; const email=form.elements.email.value.trim(); const password=form.elements.password.value; const error=$('#admin-login-error'); const submit=form.querySelector('[type="submit"]'); error.textContent='Verificando acesso…'; submit.disabled=true; try { const r=await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.supabase.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})}); if(!r.ok)throw Error('Credenciais inválidas ou serviço indisponível.'); const session=await r.json(); if(!config.supabase.adminUserId || session.user?.id?.toLowerCase()!==config.supabase.adminUserId.toLowerCase()){await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${session.access_token}`}}).catch(()=>{});throw Error('Esta conta não está autorizada a administrar o site.');} state.user=session; form.reset(); $('#admin-login-dialog').close(); $('#admin-login').hidden=true; $('#admin-logout').hidden=false; $('#property-form').hidden=false; await loadCatalog(); }catch(e){error.textContent=e.message;}finally{form.elements.password.value='';submit.disabled=false;} }
  function renderAdmin() {
    $('#admin-login').hidden=!hasSupabase()||!config.supabase.adminUserId||!!state.user; $('#admin-logout').hidden=!state.user; $('#property-form').hidden=!state.user;
    $('#admin-list').innerHTML=state.user?state.properties.map(p=>`<div class="admin-row"><span>${esc(p.title)} · ${esc(p.status)}</span><span><button class="text-button" data-edit="${esc(p.id)}">Editar</button><button class="text-button" data-delete="${esc(p.id)}">Excluir</button></span></div>`).join(''):'';
    $$('[data-edit]').forEach(b=>b.onclick=()=>fillForm(state.properties.find(p=>String(p.id)===b.dataset.edit)));
    $$('[data-delete]').forEach(b=>b.onclick=async()=>{const p=state.properties.find(x=>String(x.id)===b.dataset.delete);if(!confirm(`Excluir “${p.title}”? Esta ação não pode ser desfeita.`))return;try{await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(p.id)}`,{method:'DELETE'});await loadCatalog();}catch(e){setAdminStatus(`Falha ao excluir: ${e.message}`,true);}});
  }
  function fillForm(p) { const f=$('#property-form'); f.reset(); f.elements.id.value=p.id; ['title','description','category','region','price','area','bedrooms','suites','bathrooms','parking','payment','code','status'].forEach(k=>{if(f.elements[k])f.elements[k].value=p[k]??'';}); f.elements.features.value=Array.isArray(p.features)?p.features.join(', '):p.features||'';f.elements.featured.checked=!!p.featured;state.pendingPhotos=p.photos||[];renderPhotoPreview();f.scrollIntoView({behavior:'smooth',block:'start'}); }
  function renderPhotoPreview() { $('#photo-preview').innerHTML=state.pendingPhotos.map((p,i)=>`<div><img src="${esc(p.url)}" alt="Foto ${i+1}"><button type="button" class="text-button" data-remove-photo="${i}">Remover</button><button type="button" class="text-button" data-cover-photo="${i}">${p.path===($('#property-form').elements.cover?.value||state.pendingPhotos[0]?.path)?'Capa':'Usar capa'}</button></div>`).join(''); $$('[data-remove-photo]').forEach(b=>b.onclick=()=>{state.pendingPhotos.splice(Number(b.dataset.removePhoto),1);renderPhotoPreview();});$$('[data-cover-photo]').forEach(b=>b.onclick=()=>{const chosen=state.pendingPhotos.splice(Number(b.dataset.coverPhoto),1)[0];state.pendingPhotos.unshift(chosen);renderPhotoPreview();}); }
  async function uploadPhotos(files, propertyId) { for(const file of files) { const path=`${propertyId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`; const r=await fetch(`${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/${config.supabase.bucket}/${path}`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`,'Content-Type':file.type,'x-upsert':'true'},body:file}); if(!r.ok)throw Error(`Falha ao enviar ${file.name}: ${await r.text()}`);state.pendingPhotos.push({path,url:mediaUrl(path)}); } state.pendingPhotos=state.pendingPhotos.filter(p=>!p.path.startsWith('local-')); }
  async function saveProperty(event) { event.preventDefault(); const f=event.currentTarget;const fd=new FormData(f);const id=fd.get('id')||crypto.randomUUID();try{await uploadPhotos(fd.getAll('photos').filter(x=>x.size),id);const payload={title:fd.get('title'),description:fd.get('description'),category:fd.get('category'),region:fd.get('region'),price:Number(fd.get('price'))||null,area:Number(fd.get('area'))||null,bedrooms:Number(fd.get('bedrooms'))||null,suites:Number(fd.get('suites'))||null,bathrooms:Number(fd.get('bathrooms'))||null,parking:Number(fd.get('parking'))||null,features:String(fd.get('features')).split(',').map(x=>x.trim()).filter(Boolean),payment:fd.get('payment'),code:fd.get('code'),status:fd.get('status'),featured:fd.get('featured')==='on',photos:state.pendingPhotos,cover:state.pendingPhotos[0]?.path||null};if(fd.get('id'))await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)});else await api(encodeURIComponent(config.supabase.table),{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id,...payload})});setAdminStatus(`“${payload.title}” salvo como ${payload.status}.`);f.reset();state.pendingPhotos=[];renderPhotoPreview();await loadCatalog();}catch(e){setAdminStatus(`Não foi possível salvar o imóvel. Confira as permissões RLS e Storage. ${e.message}`,true);} }
  function setupPasswordRecovery() {
    const params = new URLSearchParams([location.search.slice(1), location.hash.slice(1)].filter(Boolean).join('&'));
    const recoveryType = params.get('type');
    let accessToken = params.get('access_token');
    const recoveryError = params.get('error_description') || params.get('error_code');
    if (recoveryType !== 'recovery' && !recoveryError) return;

    const cleanQuery = new URLSearchParams(location.search);
    ['access_token','refresh_token','code','type','error','error_code','error_description','expires_in','token_type'].forEach(key => cleanQuery.delete(key));
    history.replaceState(null, '', `${location.pathname}${cleanQuery.size ? `?${cleanQuery}` : ''}`);

    const dialog = $('#password-reset-dialog');
    const form = $('#password-reset-form');
    const status = $('#password-reset-status');
    const submit = $('#password-reset-submit');
    dialog.addEventListener('cancel', event => event.preventDefault());
    if (!accessToken || recoveryType !== 'recovery') {
      status.textContent = recoveryError || 'Este link expirou ou já foi usado. Peça um novo e-mail em Supabase → Authentication → Users → seu usuário → Send password recovery.';
      submit.disabled = true;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const password = String(data.get('password') || '');
      if (password !== data.get('passwordConfirm')) { status.textContent = 'As senhas não coincidem.'; return; }
      submit.disabled = true;
      status.textContent = 'Salvando sua nova senha…';
      try {
        const response = await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/user`, {
          method: 'PUT',
          headers: { apikey: config.supabase.anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        if (!response.ok) throw new Error((await response.text()).slice(0, 250));
        accessToken = null;
        form.hidden = true;
        $('#password-reset-success').hidden = false;
        $('#password-reset-close').onclick = () => dialog.close();
      } catch (error) {
        status.textContent = `Não foi possível atualizar a senha. ${error.message}`;
        submit.disabled = false;
      }
    });
    dialog.showModal();
  }
  function setupAdmin() { $('#admin-login').onclick=login;$('#admin-login-form').addEventListener('submit',submitAdminLogin);$('#admin-login-cancel').onclick=()=>$('#admin-login-dialog').close();$('#admin-login-dialog').addEventListener('close',()=>{const form=$('#admin-login-form');if(!state.user)form.reset();});$('#admin-logout').onclick=async()=>{try{await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`}});}catch{}state.user=null;$('#property-form').hidden=true;await loadCatalog();};$('#property-form').addEventListener('submit',saveProperty);$('#property-form').elements.photos.addEventListener('change',e=>{for(const f of e.target.files){const url=URL.createObjectURL(f);state.pendingPhotos.push({path:`local-${Date.now()}-${f.name}`,url});}renderPhotoPreview();});$('#property-form').addEventListener('reset',()=>{state.pendingPhotos=[];setTimeout(renderPhotoPreview);});$('#preview-property').onclick=()=>{const f=$('#property-form');const fd=new FormData(f);const temp={id:'preview',title:fd.get('title')||'Pré-visualização',description:fd.get('description'),category:fd.get('category'),region:fd.get('region'),price:fd.get('price'),status:'published',photos:state.pendingPhotos,featured:fd.get('featured')==='on',bedrooms:fd.get('bedrooms'),area:fd.get('area'),features:String(fd.get('features')).split(',').filter(Boolean),payment:fd.get('payment')};state.properties.unshift(temp);openProperty('preview');state.properties.shift();}; }
  function init() {
    initTheme();setupProfile();renderCategories();setupPasswordRecovery();
    $('#filter-toggle').onclick=()=>{const panel=$('#filters-panel');panel.hidden=!panel.hidden;$('#filter-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
    ['search-input','region-filter','price-filter','rooms-filter'].forEach(id=>document.getElementById(id).addEventListener('input',renderProperties));
    $('#clear-filters').onclick=()=>{$('#search-input').value='';$('#region-filter').value='';$('#price-filter').value='';$('#rooms-filter').value='';state.category='Todos';renderCategories();renderProperties();};
    $$('.modal-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());[$('#property-modal'),$('#image-modal')].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));$('#property-modal').addEventListener('close',()=>{if(location.hash.startsWith('#imovel-'))history.replaceState(null,'',location.pathname+location.search);});
    $('.gallery-prev').onclick=()=>showLarge(state.galleryIndex-1);$('.gallery-next').onclick=()=>showLarge(state.galleryIndex+1);document.addEventListener('keydown',e=>{if(e.key==='Escape')return;if($('#image-modal').open&&e.key==='ArrowLeft')showLarge(state.galleryIndex-1);if($('#image-modal').open&&e.key==='ArrowRight')showLarge(state.galleryIndex+1);});
    setupAdmin();loadCatalog().then(()=>{if(location.hash.startsWith('#imovel-'))openProperty(decodeURIComponent(location.hash.slice(8)));});
  }
  init();
})();
