(() => {
  'use strict';
  const config = window.SITE_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const MAX_PROPERTY_PHOTO_SIZE = 20 * 1024 * 1024;
  const ALLOWED_PROPERTY_PHOTO_TYPES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']);
  const state = { properties: [], category: config.categories?.[0] || null, gallery: [], galleryIndex: 0, galleryTitle: '', galleryRequestId: 0, pendingPhotos: [], coverPhoto: null, cardSlideshowTimers: [], user: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasSupabase = () => Boolean(config.supabase?.url && config.supabase?.anonKey);
  const wa = (message = 'Olá, Davi! Gostaria de conversar sobre imóveis em Cascavel.') => config.whatsapp ? `https://wa.me/${encodeURIComponent(config.whatsapp)}?text=${encodeURIComponent(message)}` : '#admin';
  const money = n => n ? `A partir de ${Number(n).toLocaleString('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:2 })}` : 'Consulte condições';
  const categoryKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const categoryAliases = { novos:'Novos', lancamentos:'Novos', cohapar:'Cohapar', 'minha casa minha vida':'Cohapar', lotes:'Lotes', terrenos:'Lotes', prontos:'Prontos', casas:'Prontos', 'apartamentos prontos':'Prontos' };
  const canonicalCategory = value => categoryAliases[categoryKey(value)] || (config.categories || []).find(category => categoryKey(category) === categoryKey(value)) || value || '';
  const propertyFeatures = p => Array.isArray(p?.features) ? p.features : (p?.features?.items || []);
  function orderedPropertyPhotos(p) {
    const photos = Array.isArray(p?.photos) ? [...p.photos] : [];
    const coverIndex = photos.findIndex(photo => photo?.path && photo.path === p.cover);
    if (coverIndex > 0) photos.unshift(photos.splice(coverIndex,1)[0]);
    return photos;
  }
  const propertyFloorPlans = p => Array.isArray(p?.features?.floor_plans) ? p.features.floor_plans : [];
  const decimal = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits:2 });
  const floorPlanLabel = plan => {
    if (typeof plan === 'string') return plan;
    return [plan.bedrooms != null ? `${plan.bedrooms} ${plan.bedrooms === 1 ? 'quarto' : 'quartos'}` : '', plan.suites != null ? (plan.suites ? `${plan.suites} ${plan.suites === 1 ? 'suíte' : 'suítes'}` : 'sem suíte') : '', plan.area ? `${decimal(plan.area)} m²` : ''].filter(Boolean).join(' · ');
  };
  function addFloorPlanRow(plan = {}) {
    const row = document.createElement('div');
    row.className = 'floor-plan-row';
    row.innerHTML = '<label>Quartos<input name="plan_bedrooms" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex.: 2"></label><label>Suítes<select name="plan_suites"><option value="">Não informado</option><option value="0">Sem suíte</option><option value="1">1 suíte</option><option value="2">2 suítes</option><option value="3">3 suítes</option></select></label><label>Área (m²)<input name="plan_area" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ex.: 62,43"></label><button class="text-button remove-floor-plan" type="button" aria-label="Remover planta">Remover</button>';
    row.querySelector('[name="plan_bedrooms"]').value = plan.bedrooms ?? '';
    row.querySelector('[name="plan_suites"]').value = plan.suites ?? '';
    row.querySelector('[name="plan_area"]').value = plan.area ?? '';
    row.querySelector('.remove-floor-plan').onclick = () => row.remove();
    $('#floor-plans-editor').append(row);
  }
  function readFloorPlans() {
    return $$('.floor-plan-row', $('#floor-plans-editor')).map(row => {
      const bedrooms = row.querySelector('[name="plan_bedrooms"]').value;
      const suites = row.querySelector('[name="plan_suites"]').value;
      const area = row.querySelector('[name="plan_area"]').value;
      return { bedrooms:bedrooms === '' ? null : Number(bedrooms), suites:suites === '' ? null : Number(suites), area:area === '' ? null : Number(area) };
    }).filter(plan => Object.values(plan).some(value => value !== null));
  }

  function initTheme() {
    const saved = localStorage.getItem('dv-theme');
    document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const button = $('#theme-toggle');
    const updateButton = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      document.querySelector('meta[name="theme-color"]').content = dark ? '#191C27' : '#F8F9FA';
      button.setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
      button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
      button.querySelector('span').textContent = dark ? '☀' : '☾';
      $$('.brand-mark').forEach(mark => { mark.src = dark ? mark.dataset.darkSrc : mark.dataset.lightSrc; });
    };
    updateButton();
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; localStorage.setItem('dv-theme', next);
      updateButton();
    });
  }
  function setupProfile() {
    if (config.profileImage) {
      $('#avatar').innerHTML = `<img src="${esc(config.profileImage)}" alt="Davi Vera">`;
      $('#avatar img').addEventListener('error', event => event.currentTarget.remove(), { once:true });
    }
    const insta = $('#instagram-link');
    if (config.instagram) { insta.href = config.instagram; insta.target = '_blank'; insta.rel = 'noopener'; } else insta.hidden = true;
    ['whatsapp-link','simulate-link','buyer-link','owner-link','about-contact'].forEach(id => {
      const el = document.getElementById(id);
      const text = id === 'owner-link' ? 'Olá, Davi! Tenho um imóvel em Cascavel e gostaria de conversar sobre anunciar.' : id === 'simulate-link' ? 'Olá, Davi! Gostaria de fazer uma simulação de crédito imobiliário.' : undefined;
      el.href = wa(text); if (!config.whatsapp) el.title = 'Configure o WhatsApp em config.js';
    });
    if (config.spotlight?.visible === false) $('#spotlight').hidden = true;
    else { $('#spotlight h2').textContent = config.spotlight?.title || $('#spotlight h2').textContent; $('#spotlight .spotlight-description').textContent = config.spotlight?.description || $('#spotlight .spotlight-description').textContent; $('#simulate-link').textContent = config.spotlight?.button || 'Fazer simulação'; }
    $('#year').textContent = new Date().getFullYear();
  }
  function filteredProperties() {
    return state.properties.filter(p => p.status === 'published' || ['reserved','sold'].includes(p.status))
      .filter(p => !state.category || canonicalCategory(p.category) === state.category);
  }
  function renderCategories() {
    const host = $('#category-filters');
    const visibleStatuses = new Set(['published','reserved','sold']);
    const available = (config.categories || []).filter(category => state.properties.some(property => visibleStatuses.has(property.status) && canonicalCategory(property.category) === category));
    if (!available.includes(state.category)) state.category = available[0] || null;
    host.hidden = available.length === 0;
    host.innerHTML = available.map(c => `<button class="category-chip ${state.category === c ? 'active':''}" type="button" data-category="${esc(c)}" aria-pressed="${state.category === c}">${state.category === c ? '<span class="category-check" aria-hidden="true">✓</span>':''}${esc(c)}</button>`).join('');
    host.onclick = e => { const b = e.target.closest('[data-category]'); if (b) { state.category = b.dataset.category; renderCategories(); renderProperties(); } };
    const select = $('#property-form select[name="category"]'); if (select) select.innerHTML = (config.categories || []).map(c => `<option>${esc(c)}</option>`).join('');
  }
  function renderProperties() {
    state.cardSlideshowTimers.forEach(clearInterval);
    state.cardSlideshowTimers = [];
    const list = filteredProperties(); const grid = $('#property-grid');
    $('#listing-count').textContent = `${list.length} ${list.length === 1 ? 'imóvel' : 'imóveis'}`;
    $('#empty-state').hidden = list.length > 0; grid.innerHTML = list.map(p => {
      const photos = orderedPropertyPhotos(p).filter(photo => photo?.url);
      const initialIndex = 0;
      const cover = photos[0]?.url || p.cover_url || '';
      const tags = [p.featured ? '<span class="badge">DESTAQUE</span>':'', p.status === 'reserved' ? '<span class="badge status">RESERVADO</span>':'', p.status === 'sold' ? '<span class="badge status">VENDIDO</span>':''].join('');
      const facts = [p.bedrooms ? `${esc(p.bedrooms)} quartos`:'', p.area ? `${decimal(p.area)} m²`:'', p.parking ? `${esc(p.parking)} vagas`:'' ].filter(Boolean).join(' · ');
      const morePhotos = photos.length > 1 ? `<button type="button" class="card-more-photos" aria-label="Ver todas as ${photos.length} fotos de ${esc(p.title)}">Ver mais fotos <span aria-hidden="true">↗</span></button>` : '';
      return `<article class="property-card" tabindex="0" role="button" data-id="${esc(p.id)}"><div class="property-image">${cover ? `<img src="${esc(cover)}" alt="${esc(p.title)}" data-photo-index="${initialIndex}" loading="lazy">`:''}<div class="property-badges">${tags}</div>${morePhotos}</div><div class="property-copy"><p class="eyebrow">${esc(canonicalCategory(p.category) || 'IMÓVEL')}</p><h3>${esc(p.title)}</h3><p class="property-region">${esc(p.region || 'Cascavel, PR')}</p><p class="property-price">${money(p.price)}</p>${facts ? `<p class="property-meta">${facts}</p>`:''}</div></article>`;
    }).join('');
    $$('.property-card', grid).forEach(card => { card.onclick = () => openProperty(card.dataset.id); card.onkeydown = e => { if (e.target.closest('.card-more-photos')) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProperty(card.dataset.id); } }; });
    $$('.card-more-photos', grid).forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); openProperty(button.closest('.property-card').dataset.id); });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $$('.property-card', grid).forEach(card => {
      const property = state.properties.find(item => String(item.id) === card.dataset.id);
      const photos = orderedPropertyPhotos(property).filter(photo => photo?.url).slice(0, 5);
      const image = $('.property-image img', card);
      if (!image || photos.length < 2) return;
      let paused = false;
      card.addEventListener('mouseenter', () => { paused = true; });
      card.addEventListener('mouseleave', () => { paused = false; });
      card.addEventListener('focusin', () => { paused = true; });
      card.addEventListener('focusout', event => { if (!card.contains(event.relatedTarget)) paused = false; });
      state.cardSlideshowTimers.push(setInterval(() => {
        if (paused || document.hidden || $('#property-modal').open || $('#image-modal').open) return;
        const index = (Number(image.dataset.photoIndex) + 1) % photos.length;
        image.classList.remove('card-photo-enter');
        void image.offsetWidth;
        image.src = photos[index].url;
        image.alt = `${property.title} — foto ${index + 1}`;
        image.dataset.photoIndex = String(index);
        image.classList.add('card-photo-enter');
      }, 4000));
    });
  }
  async function track(id) { if (!config.analyticsEndpoint) return; try { await fetch(config.analyticsEndpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event:'property_view', property_id:id, timestamp:new Date().toISOString()}) }); } catch {} }
  function modalPhotoMarkup(p) {
    const photos = orderedPropertyPhotos(p).filter(photo => photo?.url);
    if (!photos.length && p.cover_url) return `<div class="modal-photo-item"><img src="${esc(p.cover_url)}" alt="${esc(p.title)} — foto 1" data-photo-index="0" loading="lazy"></div>`;
    return photos.map((photo,i) => `<div class="modal-photo-item"><img src="${esc(photo.url)}" alt="${esc(p.title)} — foto ${i+1}" data-photo-index="${i}" loading="lazy">${state.user && String(p.id) !== 'preview' && photos.length > 1 ? `<div class="modal-photo-order"><button type="button" data-modal-photo-move="${i}" data-move-to="${i-1}" ${i===0?'disabled':''} aria-label="Mover foto ${i+1} para antes">↑</button><button type="button" data-modal-photo-move="${i}" data-move-to="${i+1}" ${i===photos.length-1?'disabled':''} aria-label="Mover foto ${i+1} para depois">↓</button></div>`:''}</div>`).join('');
  }
  async function movePropertyPhoto(p, from, to) {
    const current = orderedPropertyPhotos(p);
    if (to < 0 || to >= current.length || from < 0 || from >= current.length || from === to) return;
    const reordered = [...current];
    const [photo] = reordered.splice(from, 1);
    reordered.splice(to, 0, photo);
    const previousCover = p.cover;
    p.photos = reordered;
    p.cover = reordered[0]?.path || null;
    if (String(p.id) === 'preview') state.pendingPhotos = reordered;
    const editingThisProperty = String($('#property-form').elements.id.value) === String(p.id);
    if (editingThisProperty) { state.pendingPhotos = reordered; state.coverPhoto = p.cover; }
    try {
      if (String(p.id) !== 'preview') {
        await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(p.id)}`, { method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({photos:reordered,cover:p.cover}) });
      }
      renderProperties();
      if (editingThisProperty || String(p.id) === 'preview') renderPhotoPreview();
      openProperty(p.id);
      if (state.user && String(p.id) !== 'preview') setAdminStatus(`Ordem das fotos de “${p.title}” salva.`);
    } catch (error) {
      p.photos = current;
      p.cover = previousCover;
      if (editingThisProperty) { state.pendingPhotos = current; state.coverPhoto = previousCover; renderPhotoPreview(); }
      setAdminStatus(`Não foi possível salvar a ordem das fotos. ${error.message}`, true);
      openProperty(p.id);
    }
  }
  function openProperty(id) {
    const p = state.properties.find(x => String(x.id) === String(id)); if (!p) return;
    const propertyPhotos = orderedPropertyPhotos(p);
    const photos = propertyPhotos.map(x => x.url).filter(Boolean);
    if (!photos.length && p.cover_url) photos.push(p.cover_url);
    state.gallery = photos; state.galleryIndex = 0; state.galleryTitle = p.title; state.galleryRequestId++;
    const facts = [['Área',p.area && `${decimal(p.area)} m²`],['Quartos',p.bedrooms],['Suítes',p.suites],['Banheiros',p.bathrooms],['Vagas',p.parking]].filter(x=>x[1]);
    const features = propertyFeatures(p); const floorPlans = propertyFloorPlans(p);
    const url = new URL(location.href); url.hash = `imovel-${encodeURIComponent(p.id)}`;
    const contact = wa(`Olá, Davi! Tenho interesse no imóvel ${p.title}${p.code ? ` (código ${p.code})`:''}.`);
    $('#modal-content').innerHTML = `<div class="modal-gallery">${modalPhotoMarkup(p)}</div>${state.user && String(p.id) !== 'preview' && p.photos?.length > 1 ? '<p class="photo-order-hint">Administrador: use ↑ e ↓ nas fotos para reorganizar. A ordem é salva automaticamente.</p>':''}<div class="modal-copy"><p class="eyebrow">${esc(canonicalCategory(p.category))} · ${esc(p.region || 'Cascavel, PR')}</p><h2>${esc(p.title)}</h2><p class="modal-price">${money(p.price)}</p>${p.code ? `<p>Código do anúncio: ${esc(p.code)}</p>`:''}<div class="modal-facts">${facts.map(x=>`<span>${esc(x[0])}: ${esc(x[1])}</span>`).join('')}</div><p>${esc(p.description || '')}</p>${features.length ? `<h3>Diferenciais</h3><p>${esc(features.join(' · '))}</p>`:''}${floorPlans.length ? `<h3>Plantas disponíveis</h3><ul class="modal-floor-plans">${floorPlans.map(floorPlanLabel).filter(Boolean).map(plan=>`<li>${esc(plan)}</li>`).join('')}</ul>`:''}${p.payment ? `<h3>Condições de pagamento</h3><p>${esc(p.payment)}</p>`:''}<div class="share-actions"><a class="button button-primary" href="${esc(contact)}" ${config.whatsapp?'target="_blank" rel="noopener"':''}>Falar sobre este imóvel ↗</a><button class="button button-secondary" id="copy-property-link">Copiar link</button><button class="button button-secondary" id="share-property">Compartilhar</button></div></div>`;
    $$('.modal-gallery img').forEach(img => img.onclick = () => showLarge(Number(img.dataset.photoIndex)));
    $$('[data-modal-photo-move]').forEach(button => button.onclick = () => movePropertyPhoto(p, Number(button.dataset.modalPhotoMove), Number(button.dataset.moveTo)));
    $('#copy-property-link').onclick = async () => { await navigator.clipboard.writeText(url.href); $('#copy-property-link').textContent = 'Link copiado'; };
    $('#share-property').onclick = async () => { if (navigator.share) await navigator.share({title:p.title,url:url.href}); else { await navigator.clipboard.writeText(url.href); $('#share-property').textContent = 'Link copiado'; } };
    if (!$('#property-modal').open) $('#property-modal').showModal(); history.replaceState(null,'',url); track(p.id);
  }
  function showLarge(index) {
    if (!state.gallery.length) return;
    state.galleryIndex = (index + state.gallery.length) % state.gallery.length;
    const source = state.gallery[state.galleryIndex];
    const image = $('#large-image');
    const dialog = $('#image-modal');
    const requestId = ++state.galleryRequestId;
    $('#gallery-count').textContent = `${state.galleryIndex + 1} / ${state.gallery.length}`;
    $('.gallery-prev').hidden = state.gallery.length < 2;
    $('.gallery-next').hidden = state.gallery.length < 2;
    if (!dialog.open) dialog.showModal();

    let committed = false;
    const commitImage = () => {
      if (committed || requestId !== state.galleryRequestId) return;
      committed = true;
      image.src = source;
      image.alt = `${state.galleryTitle} — foto ${state.galleryIndex + 1}`;
      if (typeof image.animate === 'function') {
        image.animate([
          { opacity: 0, transform: 'translateY(10px) scale(.985)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }
        ], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
      const nextSource = state.gallery[(state.galleryIndex + 1) % state.gallery.length];
      if (nextSource && nextSource !== source) { const nextImage = new Image(); nextImage.src = nextSource; }
    };
    const preload = new Image();
    preload.onload = commitImage;
    preload.onerror = commitImage;
    preload.src = source;
    if (preload.complete) requestAnimationFrame(commitImage);
  }
  function authHeaders() { return {'apikey':config.supabase.anonKey, 'Authorization':`Bearer ${state.user?.access_token || config.supabase.anonKey}`, 'Content-Type':'application/json'}; }
  async function api(path, options={}) {
    const response = await fetch(`${config.supabase.url.replace(/\/$/,'')}/rest/v1/${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    const body = await response.text();
    if (!response.ok) throw new Error(`Supabase (${response.status}): ${(body || response.statusText).slice(0,350)}`);
    // PostgREST returns an empty body for Prefer: return=minimal (commonly HTTP 201 on insert).
    if (!body.trim()) return null;
    try { return JSON.parse(body); }
    catch { throw new Error('Supabase retornou uma resposta inválida ao salvar o imóvel.'); }
  }
  function setAdminStatus(text, error=false) { const e=$('#admin-status'); e.textContent=text; e.style.color=error?'#b2483c':''; }
  function mediaUrl(path) { return `${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/public/${config.supabase.bucket}/${path}`; }
  async function loadCatalog() {
    if (!hasSupabase()) { state.properties=[]; renderCategories(); renderProperties(); setAdminStatus('O catálogo ainda não está conectado. Para publicar imóveis, configure o Supabase, o ID da sua conta administradora e as políticas de acesso descritas no README.'); return; }
    try { state.properties=await api(`${encodeURIComponent(config.supabase.table)}?select=*&order=created_at.desc`) || []; setAdminStatus(state.user ? `Conectado como ${state.user.email}.` : 'Catálogo conectado. Entre como administrador para gerenciar anúncios.'); }
    catch(e) { state.properties=[]; setAdminStatus(`Não foi possível carregar o catálogo. Confira tabela, políticas de leitura e conexão. ${e.message}`,true); }
    renderCategories(); renderProperties(); renderAdmin();
  }
  function login() { const dialog=$('#admin-login-dialog'); $('#admin-login-error').textContent=''; dialog.showModal(); $('#admin-login-form').elements.email.focus(); }
  async function submitAdminLogin(event) { event.preventDefault(); const form=event.currentTarget; const email=form.elements.email.value.trim(); const password=form.elements.password.value; const error=$('#admin-login-error'); const submit=form.querySelector('[type="submit"]'); error.textContent='Verificando acesso…'; submit.disabled=true; try { const r=await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.supabase.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})}); if(!r.ok)throw Error('Credenciais inválidas ou serviço indisponível.'); const session=await r.json(); if(!config.supabase.adminUserId || session.user?.id?.toLowerCase()!==config.supabase.adminUserId.toLowerCase()){await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${session.access_token}`}}).catch(()=>{});throw Error('Esta conta não está autorizada a administrar o site.');} state.user=session; form.reset(); $('#admin-login-dialog').close(); $('#admin-login').hidden=true; $('#admin-logout').hidden=false; $('#property-form').hidden=false; await loadCatalog(); }catch(e){error.textContent=e.message;}finally{form.elements.password.value='';submit.disabled=false;} }
  function renderAdmin() {
    $('#admin-login').hidden=!hasSupabase()||!config.supabase.adminUserId||!!state.user; $('#admin-logout').hidden=!state.user; $('#property-form').hidden=!state.user;
    $('#admin-list').innerHTML=state.user?state.properties.map(p=>`<div class="admin-row"><span>${esc(p.title)} · ${esc(p.status)}</span><span><button class="text-button" data-edit="${esc(p.id)}">Editar</button><button class="text-button" data-delete="${esc(p.id)}">Excluir</button></span></div>`).join(''):'';
    $$('[data-edit]').forEach(b=>b.onclick=()=>fillForm(state.properties.find(p=>String(p.id)===b.dataset.edit)));
    $$('[data-delete]').forEach(b=>b.onclick=async()=>{const p=state.properties.find(x=>String(x.id)===b.dataset.delete);if(!confirm(`Excluir “${p.title}”? Esta ação não pode ser desfeita.`))return;try{await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(p.id)}`,{method:'DELETE'});await loadCatalog();}catch(e){setAdminStatus(`Falha ao excluir: ${e.message}`,true);}});
  }
  function setPropertyFormMode(editing, title = '') {
    $('#property-form-mode').hidden = !editing;
    $('#property-form-mode').textContent = editing ? `Editando imóvel: ${title}` : '';
    $('#property-form').querySelector('[type="submit"]').textContent = editing ? 'Salvar alterações' : 'Salvar imóvel';
    $('#clear-property-form').hidden = editing;
    $('#cancel-property-edit').hidden = !editing;
  }
  function fillForm(p) { const f=$('#property-form'); f.reset(); f.elements.id.value=p.id; ['title','description','category','region','price','area','bedrooms','suites','bathrooms','parking','payment','code','status'].forEach(k=>{if(f.elements[k])f.elements[k].value=p[k]??'';}); f.elements.category.value=canonicalCategory(p.category); f.elements.features.value=propertyFeatures(p).join(', '); propertyFloorPlans(p).forEach(plan=>addFloorPlanRow(plan));f.elements.featured.checked=!!p.featured;state.pendingPhotos=orderedPropertyPhotos(p);state.coverPhoto=state.pendingPhotos[0]?.path||null;setPropertyFormMode(true,p.title);renderPhotoPreview();f.scrollIntoView({behavior:'smooth',block:'start'}); }
  function movePendingPhoto(from, to) {
    if (to < 0 || to >= state.pendingPhotos.length || from < 0 || from >= state.pendingPhotos.length) return;
    const [photo] = state.pendingPhotos.splice(from, 1);
    state.pendingPhotos.splice(to, 0, photo);
    state.coverPhoto = state.pendingPhotos[0]?.path || null;
    renderPhotoPreview();
  }
  function renderPhotoPreview() {
    $('#photo-preview').innerHTML = `${state.pendingPhotos.length>1?'<p class="photo-order-hint">Use as setas para mudar a ordem das fotos. A primeira será a capa e aparecerá primeiro no site.</p>':''}${state.pendingPhotos.map((p,i) => `<div class="photo-preview-item"><img src="${esc(p.url)}" alt="Foto ${i+1}"><span class="photo-order-label">Foto ${i+1}${p.path===state.coverPhoto?' · Capa':''}</span><div class="photo-order-actions"><button type="button" data-preview-photo-move="${i}" data-move-to="${i-1}" ${i===0?'disabled':''} aria-label="Mover foto ${i+1} para antes">↑</button><button type="button" data-preview-photo-move="${i}" data-move-to="${i+1}" ${i===state.pendingPhotos.length-1?'disabled':''} aria-label="Mover foto ${i+1} para depois">↓</button><button type="button" data-remove-photo="${i}">Remover</button></div><button type="button" class="text-button" data-cover-photo="${i}">Usar como capa</button></div>`).join('')}`;
    $$('[data-remove-photo]').forEach(button => button.onclick = () => { const [removed] = state.pendingPhotos.splice(Number(button.dataset.removePhoto),1); if (removed?.path === state.coverPhoto) state.coverPhoto = state.pendingPhotos[0]?.path || null; renderPhotoPreview(); });
    $$('[data-cover-photo]').forEach(button => button.onclick = () => movePendingPhoto(Number(button.dataset.coverPhoto),0));
    $$('[data-preview-photo-move]').forEach(button => button.onclick = () => movePendingPhoto(Number(button.dataset.previewPhotoMove),Number(button.dataset.moveTo)));
  }
  async function uploadPhotos(files, propertyId) {
    for (const file of files) {
      if (!ALLOWED_PROPERTY_PHOTO_TYPES.has(file.type)) throw Error(`Formato não permitido para “${file.name}”. Use JPEG, PNG, WebP, AVIF, HEIC ou HEIF.`);
      if (file.size > MAX_PROPERTY_PHOTO_SIZE) throw Error(`“${file.name}” excede o limite de 20 MB por foto.`);
    }
    for(const file of files) { const path=`${propertyId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`; const r=await fetch(`${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/${config.supabase.bucket}/${path}`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`,'Content-Type':file.type,'x-upsert':'true'},body:file}); if(!r.ok)throw Error(`Falha ao enviar ${file.name}: ${await r.text()}`);state.pendingPhotos.push({path,url:mediaUrl(path)});if(!state.coverPhoto)state.coverPhoto=path; } state.pendingPhotos=state.pendingPhotos.filter(p=>!p.path.startsWith('local-')); }
  async function saveProperty(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const id = formData.get('id') || crypto.randomUUID();
    submit.disabled = true;
    submit.textContent = 'Salvando…';
    try {
      await uploadPhotos(formData.getAll('photos').filter(file => file.size), id);
      const payload = {
        title: formData.get('title'), description: formData.get('description'), category: formData.get('category'), region: formData.get('region'),
        price: Number(formData.get('price')) || null, area: Number(formData.get('area')) || null,
        bedrooms: Number(formData.get('bedrooms')) || null, suites: Number(formData.get('suites')) || null,
        bathrooms: Number(formData.get('bathrooms')) || null, parking: Number(formData.get('parking')) || null,
        features: { items:String(formData.get('features')).split(',').map(value => value.trim()).filter(Boolean), floor_plans:readFloorPlans() },
        payment: formData.get('payment'), code: formData.get('code'), status: formData.get('status'),
        featured: formData.get('featured') === 'on', photos: state.pendingPhotos, cover: state.coverPhoto || state.pendingPhotos[0]?.path || null
      };
      if (formData.get('id')) {
        await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(id)}`, { method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify(payload) });
      } else {
        await api(encodeURIComponent(config.supabase.table), { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({id,...payload}) });
      }
      setAdminStatus(`“${payload.title}” salvo como ${payload.status}.`);
      form.reset(); state.pendingPhotos = []; state.coverPhoto = null; setPropertyFormMode(false); renderPhotoPreview();
      await loadCatalog();
    } catch (error) {
      setAdminStatus(`Não foi possível salvar o imóvel. ${error.message}`, true);
    } finally {
      submit.disabled = false;
      submit.textContent = form.elements.id.value ? 'Salvar alterações' : 'Salvar imóvel';
    }
  }
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
  function setupAdmin() { $('#admin-login').onclick=login;$('#admin-login-form').addEventListener('submit',submitAdminLogin);$('#admin-login-cancel').onclick=()=>$('#admin-login-dialog').close();$('#admin-login-dialog').addEventListener('close',()=>{const form=$('#admin-login-form');if(!state.user)form.reset();});$('#admin-logout').onclick=async()=>{try{await fetch(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`}});}catch{}state.user=null;$('#property-form').reset();state.pendingPhotos=[];state.coverPhoto=null;setPropertyFormMode(false);$('#property-form').hidden=true;await loadCatalog();};$('#property-form').addEventListener('submit',saveProperty);$('#add-floor-plan').onclick=()=>addFloorPlanRow();$('#property-form').elements.photos.addEventListener('change',e=>{for(const f of e.target.files){const url=URL.createObjectURL(f);state.pendingPhotos.push({path:`local-${Date.now()}-${f.name}`,url});}renderPhotoPreview();});$('#property-form').addEventListener('reset',()=>{state.pendingPhotos=[];state.coverPhoto=null;$('#floor-plans-editor').replaceChildren();setTimeout(renderPhotoPreview);});$('#cancel-property-edit').onclick=()=>{const form=$('#property-form');form.reset();setPropertyFormMode(false);renderPhotoPreview();};$('#preview-property').onclick=()=>{const f=$('#property-form');const fd=new FormData(f);const temp={id:'preview',title:fd.get('title')||'Pré-visualização',description:fd.get('description'),category:fd.get('category'),region:fd.get('region'),price:fd.get('price'),status:'published',photos:state.pendingPhotos,featured:fd.get('featured')==='on',bedrooms:fd.get('bedrooms'),area:fd.get('area'),features:{items:String(fd.get('features')).split(',').map(value=>value.trim()).filter(Boolean),floor_plans:readFloorPlans()},payment:fd.get('payment')};state.properties.unshift(temp);openProperty('preview');state.properties.shift();}; }
  function init() {
    initTheme();setupProfile();renderCategories();setupPasswordRecovery();
    $$('.modal-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());[$('#property-modal'),$('#image-modal'),$('#about-modal')].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));$('#avatar').addEventListener('click',()=>$('#about-modal').showModal());$('#property-modal').addEventListener('close',()=>{if(location.hash.startsWith('#imovel-'))history.replaceState(null,'',location.pathname+location.search);});
    $('.gallery-prev').onclick=()=>showLarge(state.galleryIndex-1);$('.gallery-next').onclick=()=>showLarge(state.galleryIndex+1);document.addEventListener('keydown',e=>{if(e.key==='Escape')return;if($('#image-modal').open&&e.key==='ArrowLeft')showLarge(state.galleryIndex-1);if($('#image-modal').open&&e.key==='ArrowRight')showLarge(state.galleryIndex+1);});
    setupAdmin();loadCatalog().then(()=>{if(location.hash.startsWith('#imovel-'))openProperty(decodeURIComponent(location.hash.slice(8)));});
  }
  init();
})();
