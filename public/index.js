/* ==========================================================================
   MUSICBOXD - APPLICATION LOGIC & ROUTER (SUPABASE PROD VERSION)
   Vanilla JavaScript Single Page Application (SPA) Client
   ========================================================================== */

// CONSTANTES DO ESTADO GLOBAL
const STATE = {
  currentUser: null, // Guardará o objeto do usuário logado {username, displayName, avatar}
  currentView: 'landing',
  routeParams: {},
  searchDebounceTimer: null,
  activeRating: 0, // Nota selecionada no modal (0.5 - 5.0)
  playlistTracks: [], // Músicas temporárias sendo adicionadas à playlist em edição
  socialActiveTab: 'chats', // 'chats' ou 'friends'
  activeChatFriend: null, // username do amigo ativo no chat
  chatPollingInterval: null // Intervalo do setInterval
};

// INICIALIZADOR DO APLICATIVO
document.addEventListener('DOMContentLoaded', () => {
  // Carregar sessão existente do localStorage
  const savedSession = localStorage.getItem('user');
  if (savedSession) {
    try {
      STATE.currentUser = JSON.parse(savedSession);
    } catch (err) {
      localStorage.removeItem('user');
    }
  }

  // Configurações globais
  renderHeaderNavigation();
  setupSPAInterceptors();
  setupGlobalSearch();
  setupModalListeners();
  setupStarRatingSelector();
  setupAuthTabSwitching();
  
  // Renderizar a rota inicial
  handleCurrentRoute();
  
  // Monitorar botões voltar/avançar do navegador
  window.addEventListener('popstate', () => {
    handleCurrentRoute();
  });
});

// ==========================================
// 1. GERENCIAMENTO DE SESSÃO E RENDER DE HEADER
// ==========================================

function isLoggedIn() {
  return !!STATE.currentUser;
}

function renderHeaderNavigation() {
  const navContainer = document.getElementById('app-nav-container');
  const mobileContainer = document.getElementById('mobile-links-container');
  const searchWrap = document.getElementById('header-search-wrap');
  const mobileSearchWrap = document.getElementById('mobile-search-wrap');

  if (isLoggedIn()) {
    // Exibe barra de pesquisa para usuários logados
    if (searchWrap) searchWrap.style.display = 'block';
    if (mobileSearchWrap) mobileSearchWrap.style.display = 'block';

    const user = STATE.currentUser;
    const navHtml = `
      <a href="/" class="nav-link active" data-view="dashboard"><i class="fa-solid fa-house"></i> Início</a>
      <a href="/playlists" class="nav-link" data-view="playlists"><i class="fa-solid fa-list-ul"></i> Playlists</a>
      <a href="/social" class="nav-link" data-view="social"><i class="fa-solid fa-user-group"></i> Social</a>
      <a href="/perfil/${user.username}" class="nav-link" data-view="profile">
        <img src="${user.avatar}" alt="${user.displayName}" class="nav-avatar">
        Perfil
      </a>
      <a href="#" class="nav-link" id="nav-btn-logout" style="color: var(--color-orange);"><i class="fa-solid fa-right-from-bracket"></i> Sair</a>
    `;

    const mobileHtml = `
      <a href="/" class="mobile-link" data-view="dashboard">Início</a>
      <a href="/playlists" class="mobile-link" data-view="playlists">Playlists</a>
      <a href="/social" class="mobile-link" data-view="social">Social</a>
      <a href="/perfil/${user.username}" class="mobile-link" data-view="profile">Meu Perfil</a>
      <a href="#" class="mobile-link" id="mobile-btn-logout" style="color: var(--color-orange);">Sair da Conta</a>
    `;

    navContainer.innerHTML = navHtml;
    mobileContainer.innerHTML = mobileHtml;

    // Configurar logout
    document.getElementById('nav-btn-logout').addEventListener('click', (e) => { e.preventDefault(); performLogout(); });
    document.getElementById('mobile-btn-logout').addEventListener('click', (e) => { e.preventDefault(); performLogout(); });

  } else {
    // Oculta barra de pesquisa para visitantes
    if (searchWrap) searchWrap.style.display = 'none';
    if (mobileSearchWrap) mobileSearchWrap.style.display = 'none';

    const navHtml = `
      <button class="btn btn-secondary" id="nav-btn-login" style="border-radius:20px; padding: 6px 16px;">Entrar</button>
      <button class="btn btn-primary" id="nav-btn-register" style="border-radius:20px; padding: 6px 16px;">Cadastrar-se</button>
    `;

    const mobileHtml = `
      <a href="#" class="mobile-link" id="mobile-btn-login">Fazer Login</a>
      <a href="#" class="mobile-link" id="mobile-btn-register" style="color:var(--color-green);">Cadastrar-se</a>
    `;

    navContainer.innerHTML = navHtml;
    mobileContainer.innerHTML = mobileHtml;

    // Configurar botões para abrir modal de login
    document.getElementById('nav-btn-login').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('nav-btn-register').addEventListener('click', () => openAuthModal('signup'));
    document.getElementById('mobile-btn-login').addEventListener('click', (e) => { e.preventDefault(); openAuthModal('login'); });
    document.getElementById('mobile-btn-register').addEventListener('click', (e) => { e.preventDefault(); openAuthModal('signup'); });
  }
}

function performLogout() {
  localStorage.removeItem('user');
  STATE.currentUser = null;
  showToast('Você encerrou sua sessão.', 'info');
  renderHeaderNavigation();
  navigateTo('/');
}

// ==========================================
// 2. ROTAS E NAVEGAÇÃO SPA (Single Page Router)
// ==========================================

function navigateTo(url) {
  window.history.pushState(null, '', url);
  handleCurrentRoute();
}

function setupSPAInterceptors() {
  document.body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.getAttribute('href');
    if (href && href.startsWith('/') && !href.startsWith('/api') && link.target !== '_blank') {
      e.preventDefault();
      navigateTo(href);
    }
  });

  const mobileMenu = document.getElementById('mobile-menu');
  const mobileToggle = document.getElementById('mobile-toggle');
  
  mobileToggle.addEventListener('click', () => {
    mobileMenu.classList.toggle('active');
  });

  document.body.addEventListener('click', (e) => {
    if (!e.target.closest('#mobile-toggle') && !e.target.closest('#mobile-menu')) {
      mobileMenu.classList.remove('active');
    }
  });
}

function handleCurrentRoute() {
  const path = window.location.pathname;
  let view = 'dashboard';
  let params = {};

  // Limpar o polling do chat ao navegar para qualquer outra tela
  if (STATE.chatPollingInterval) {
    clearInterval(STATE.chatPollingInterval);
    STATE.chatPollingInterval = null;
  }

  updateNavActiveLinks(path);

  // Redirecionamento da landing page se deslogado
  if (!isLoggedIn()) {
    if (path === '/' || path === '') {
      view = 'landing';
    } else if (path.startsWith('/track/') || path.startsWith('/album/') || path.startsWith('/artist/')) {
      // Visitantes deslogados PODEM ver detalhes do item (modo convidado)
      const parts = path.split('/');
      view = 'details';
      params.type = parts[1];
      params.id = parts[2];
    } else {
      // Redireciona qualquer outra rota privada de volta para a landing page
      view = 'landing';
      window.history.replaceState(null, '', '/');
    }
  } else {
    // Rotas para usuários logados
    if (path === '/' || path === '') {
      view = 'dashboard';
    } else if (path.startsWith('/search')) {
      view = 'search';
      const queryParams = new URLSearchParams(window.location.search);
      params.q = queryParams.get('q') || '';
    } else if (path.startsWith('/playlists')) {
      const parts = path.split('/');
      if (parts[2]) {
        view = 'playlist-details';
        params.id = parts[2];
      } else {
        view = 'playlists';
      }
    } else if (path.startsWith('/social')) {
      view = 'social';
    } else if (path.startsWith('/perfil/')) {
      view = 'profile';
      params.username = path.split('/')[2] || STATE.currentUser.username;
    } else if (path.startsWith('/track/') || path.startsWith('/album/') || path.startsWith('/artist/')) {
      const parts = path.split('/');
      view = 'details';
      params.type = parts[1];
      params.id = parts[2];
    } else {
      view = 'dashboard';
    }
  }

  STATE.currentView = view;
  STATE.routeParams = params;
  
  renderView(view, params);
}

function updateNavActiveLinks(path) {
  document.querySelectorAll('.nav-link, .mobile-link').forEach(link => {
    link.classList.remove('active');
    const viewName = link.getAttribute('data-view');
    
    if (path === '/' && viewName === 'dashboard') {
      link.classList.add('active');
    } else if (path.startsWith('/playlists') && viewName === 'playlists') {
      link.classList.add('active');
    } else if (path.startsWith('/social') && viewName === 'social') {
      link.classList.add('active');
    } else if (path.startsWith('/perfil') && viewName === 'profile') {
      link.classList.add('active');
    }
  });
}

// ==========================================
// 3. FUNÇÕES AUXILIARES DA API (fetch)
// ==========================================

async function apiFetch(endpoint, options = {}) {
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Erro de API: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Erro ao chamar ${endpoint}:`, error);
    showToast(error.message || 'Erro de conexão com o servidor', 'warning');
    throw error;
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
  if (type === 'info') icon = '<i class="fa-solid fa-circle-info"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// 4. BARRA DE PESQUISA E AUTOCOMPLETE
// ==========================================

function setupGlobalSearch() {
  const searchInput = document.getElementById('global-search-input');
  const autocompleteContainer = document.getElementById('search-autocomplete-results');

  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(STATE.searchDebounceTimer);
    
    if (!query) {
      autocompleteContainer.style.display = 'none';
      return;
    }

    STATE.searchDebounceTimer = setTimeout(async () => {
      try {
        const results = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(query)}&limit=5`);
        renderAutocomplete(results);
      } catch (err) {
        autocompleteContainer.style.display = 'none';
      }
    }, 400);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-search')) {
      autocompleteContainer.style.display = 'none';
    }
  });

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) {
        autocompleteContainer.style.display = 'none';
        navigateTo(`/search?q=${encodeURIComponent(query)}`);
      }
    }
  });

  const mobileInput = document.getElementById('mobile-search-input');
  mobileInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = mobileInput.value.trim();
      if (query) {
        navigateTo(`/search?q=${encodeURIComponent(query)}`);
      }
    }
  });
}

function renderAutocomplete(results) {
  const container = document.getElementById('search-autocomplete-results');
  container.innerHTML = '';

  const items = [];
  if (results.tracks?.items) {
    results.tracks.items.slice(0, 3).forEach(t => items.push({ ...t, typeName: 'track', badge: 'Música' }));
  }
  if (results.albums?.items) {
    results.albums.items.slice(0, 2).forEach(a => items.push({ ...a, typeName: 'album', badge: 'Álbum' }));
  }
  if (results.artists?.items) {
    results.artists.items.slice(0, 2).forEach(art => items.push({ ...art, typeName: 'artist', badge: 'Artista' }));
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="autocomplete-item"><p style="color:var(--text-muted); font-size: 13px;">Nenhum resultado</p></div>';
    container.style.display = 'block';
    return;
  }

  items.forEach(item => {
    let coverImg = 'https://placehold.co/80';
    if (item.images && item.images.length > 0) coverImg = item.images[0].url;
    else if (item.album && item.album.images && item.album.images.length > 0) coverImg = item.album.images[0].url;

    const sub = item.typeName === 'track' 
      ? item.artists.map(a => a.name).join(', ') 
      : (item.typeName === 'album' ? item.artists.map(a => a.name).join(', ') : 'Artista');

    const el = document.createElement('div');
    el.className = 'autocomplete-item';
    el.innerHTML = `
      <img src="${coverImg}" class="autocomplete-cover ${item.typeName === 'artist' ? 'artist-round' : ''}" alt="${item.name}">
      <div class="autocomplete-info">
        <div class="autocomplete-name">${item.name}</div>
        <div class="autocomplete-sub">${sub}</div>
      </div>
      <span class="autocomplete-badge">${item.badge}</span>
    `;

    el.addEventListener('click', () => {
      container.style.display = 'none';
      document.getElementById('global-search-input').value = '';
      navigateTo(`/${item.typeName}/${item.id}`);
    });

    container.appendChild(el);
  });

  container.style.display = 'block';
}

// ==========================================
// 5. INJEÇÃO DINÂMICA DE VISUALIZAÇÕES (SPA VIEWS)
// ==========================================

async function renderView(view, params) {
  const container = document.getElementById('app-view');
  
  container.innerHTML = `
    <div class="view-loading">
      <div class="spinner"></div>
      <p>Sincronizando dados...</p>
    </div>
  `;

  try {
    switch (view) {
      case 'landing':
        renderLandingView(container);
        break;
      case 'dashboard':
        await renderDashboardView(container);
        break;
      case 'search':
        await renderSearchView(container, params.q);
        break;
      case 'details':
        await renderDetailsView(container, params.type, params.id);
        break;
      case 'playlists':
        await renderPlaylistsView(container);
        break;
      case 'playlist-details':
        await renderPlaylistDetailsView(container, params.id);
        break;
      case 'social':
        await renderSocialView(container);
        break;
      case 'profile':
        await renderProfileView(container, params.username);
        break;
    }
  } catch (error) {
    container.innerHTML = `
      <div style="text-align:center; padding: 60px 20px;">
        <i class="fa-solid fa-circle-exclamation" style="font-size: 50px; color: var(--color-orange); margin-bottom: 20px;"></i>
        <h2>Erro de comunicação</h2>
        <p style="color: var(--text-secondary); margin-top: 8px;">${error.message || 'Verifique sua conexão com o Supabase.'}</p>
        <button class="btn btn-secondary" onclick="navigateTo('/')" style="margin-top: 20px;">Tentar Novamente</button>
      </div>
    `;
  }
}

// 5.1 VIEW: LANDING PAGE (Visitantes deslogados)
function renderLandingView(container) {
  container.innerHTML = `
    <div class="landing-hero">
      <div class="landing-logo"><i class="fa-solid fa-circle-play"></i></div>
      <h1 class="landing-title">Seu espaço para amar <span>música.</span></h1>
      <p class="landing-subtitle">Crie seu diário de audição musical, faça reviews completas, monte playlists colaborativas e compartilhe suas notas com uma comunidade real.</p>
      
      <div class="cta-buttons">
        <button class="btn btn-primary btn-cta-register" style="height: 48px; padding: 0 30px; font-size:16px;">
          <i class="fa-solid fa-user-plus"></i> Criar Conta Grátis
        </button>
        <button class="btn btn-secondary btn-cta-login" style="height: 48px; padding: 0 30px; font-size:16px;">
          <i class="fa-solid fa-right-to-bracket"></i> Fazer Login
        </button>
      </div>
    </div>

    <!-- Grade de Benefícios -->
    <div class="landing-features-grid">
      <div class="feature-card glassmorphism">
        <div class="feature-icon"><i class="fa-solid fa-star-half-stroke"></i></div>
        <h3 class="feature-title">Avalie com Precisão</h3>
        <p class="feature-desc">Dê notas de 0.5 a 5.0 estrelas, adicione opiniões em texto e marque suas canções favoritas com um diário organizado.</p>
      </div>

      <div class="feature-card glassmorphism">
        <div class="feature-icon"><i class="fa-solid fa-compact-disc"></i></div>
        <h3 class="feature-title">Monte suas Listas</h3>
        <p class="feature-desc">Crie playlists customizadas buscando músicas diretamente no catálogo completo do Spotify, catalogando seu acervo.</p>
      </div>

      <div class="feature-card glassmorphism">
        <div class="feature-icon"><i class="fa-solid fa-chart-simple"></i></div>
        <h3 class="feature-title">Histórico & Estatísticas</h3>
        <p class="feature-desc">Acompanhe seu gráfico de distribuição de notas (estilo Letterboxd), total de álbuns ouvidos e seus maiores destaques.</p>
      </div>
    </div>

    <!-- CTA Final -->
    <div class="landing-cta-box glassmorphism">
      <h2 class="cta-title">Pronto para começar sua jornada musical?</h2>
      <p class="cta-desc">Junte-se ao Musicboxd hoje mesmo. É grátis e leva menos de 1 minuto para se cadastrar.</p>
      <button class="btn btn-primary btn-cta-register" style="padding: 12px 30px; font-size: 15px;">Começar Agora</button>
    </div>
  `;

  // Configurar ações dos CTAs da Landing Page
  document.querySelectorAll('.btn-cta-register').forEach(b => b.addEventListener('click', () => openAuthModal('signup')));
  document.querySelectorAll('.btn-cta-login').forEach(b => b.addEventListener('click', () => openAuthModal('login')));
}

// 5.2 VIEW: DASHBOARD (Logado)
async function renderDashboardView(container) {
  const [popTracks, popAlbums, reviews] = await Promise.all([
    apiFetch('/api/spotify/search?q=year:2026%20genre:electronic&type=track&limit=6'),
    apiFetch('/api/spotify/search?q=year:2025-2026%20genre:pop&type=album&limit=6'),
    apiFetch('/api/reviews')
  ]);

  const trackItems = popTracks.tracks?.items || [];
  const albumItems = popAlbums.albums?.items || [];

  container.innerHTML = `
    <div class="dashboard-hero">
      <h1 class="hero-title">Bem-vindo de volta, <span>${escapeHTML(STATE.currentUser.displayName)}!</span></h1>
      <p class="hero-subtitle">O que você andou ouvindo recentemente? Busque e avalie qualquer música do Spotify.</p>
    </div>

    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-record-vinyl"></i> Álbuns em Destaque</h2>
      <button class="btn btn-secondary" onclick="document.getElementById('global-search-input').focus()">Pesquisar Mais <i class="fa-solid fa-magnifying-glass"></i></button>
    </div>
    <div class="music-grid">
      ${albumItems.map(album => renderMusicGridCard(album, 'album')).join('')}
    </div>

    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-music"></i> Músicas Recomendadas</h2>
    </div>
    <div class="music-grid" style="margin-bottom: 40px;">
      ${trackItems.map(track => renderMusicGridCard(track, 'track')).join('')}
    </div>

    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-comments"></i> Avaliações da Comunidade</h2>
    </div>
    <div class="reviews-list">
      ${reviews.length === 0 
        ? '<div class="glassmorphism" style="padding:40px; border-radius: var(--border-radius-md); text-align:center; color: var(--text-muted);">Ainda não há avaliações no Supabase. Escreva a primeira avaliação de uma música!</div>'
        : reviews.slice(0, 5).map(rev => renderReviewRowCard(rev)).join('')
      }
    </div>
  `;

  setupCardActionListeners();
}

function renderMusicGridCard(item, type) {
  let coverImg = 'https://placehold.co/180';
  if (item.images && item.images.length > 0) coverImg = item.images[0].url;
  else if (item.album && item.album.images && item.album.images.length > 0) coverImg = item.album.images[0].url;

  const artistName = item.artists ? item.artists.map(a => a.name).join(', ') : '';
  const typeLabel = type === 'track' ? 'Música' : (type === 'album' ? 'Álbum' : 'Artista');

  const overlayHtml = isLoggedIn() 
    ? `
      <div class="card-overlay">
        <button class="overlay-btn btn-log" title="Avaliar / Escrever Review"><i class="fa-solid fa-pen"></i></button>
        <button class="overlay-btn btn-favorite" title="Destaque no Perfil"><i class="fa-regular fa-heart"></i></button>
      </div>
    `
    : '';

  return `
    <div class="music-card ${type === 'artist' ? 'artist-card' : ''}" data-id="${item.id}" data-type="${type}" data-name="${escapeHTML(item.name)}" data-artist="${escapeHTML(artistName)}" data-image="${coverImg}">
      <div class="card-image-wrap">
        <img src="${coverImg}" class="card-image" alt="${item.name}">
        ${overlayHtml}
      </div>
      <div class="card-info">
        <a href="/${type}/${item.id}" class="card-title" title="${item.name}">${item.name}</a>
        <span class="card-artist">${artistName}</span>
        <div class="card-meta">
          <span class="card-badge">${typeLabel}</span>
        </div>
      </div>
    </div>
  `;
}

function renderReviewRowCard(rev) {
  const starsHtml = '★'.repeat(Math.floor(rev.rating)) + (rev.rating % 1 !== 0 ? '½' : '') + '☆'.repeat(5 - Math.ceil(rev.rating));
  const heartHtml = rev.liked ? '<i class="fa-solid fa-heart review-heart-icon" title="Favorito"></i>' : '';

  return `
    <div class="review-row-card glassmorphism">
      <img src="${rev.itemImage}" class="review-item-cover ${rev.itemType === 'artist' ? 'artist-round' : ''}" alt="${rev.itemName}" onclick="navigateTo('/${rev.itemType}/${rev.itemId}')">
      <div class="review-content-wrap">
        <div class="review-meta-header">
          <div class="review-user-info">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${rev.username}" class="review-avatar" alt="${rev.username}">
            <a href="/perfil/${rev.username}" class="review-user-name">${escapeHTML(rev.username)}</a>
            <span class="review-date">${formatDate(rev.dateLogged)}</span>
          </div>
          <div class="review-stars-score">
            ${starsHtml} ${heartHtml}
          </div>
        </div>
        <div class="review-item-title">
          <a href="/${rev.itemType}/${rev.itemId}">${rev.itemName}</a>
          ${rev.itemArtist ? `<span class="artist">de ${rev.itemArtist}</span>` : ''}
        </div>
        <p class="review-text">${escapeHTML(rev.reviewText)}</p>
      </div>
    </div>
  `;
}

// 5.3 VIEW: BUSCA E FILTROS
async function renderSearchView(container, query) {
  if (!query) {
    container.innerHTML = `<p style="text-align:center; padding: 40px;">Por favor, digite termos de busca válidos.</p>`;
    return;
  }

  const results = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);

  const tracks = results.tracks?.items || [];
  const albums = results.albums?.items || [];
  const artists = results.artists?.items || [];

  container.innerHTML = `
    <div class="section-header" style="margin-top: 20px;">
      <div>
        <h2 class="section-title"><i class="fa-solid fa-magnifying-glass"></i> Resultados para "${escapeHTML(query)}"</h2>
        <p style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">Exibindo dados retornados em tempo real do catálogo Spotify.</p>
      </div>
    </div>

    <div class="profile-tabs" style="margin-bottom: 24px;">
      <button class="tab-btn active" data-search-tab="tracks">Músicas (${tracks.length})</button>
      <button class="tab-btn" data-search-tab="albums">Álbuns (${albums.length})</button>
      <button class="tab-btn" data-search-tab="artists">Artistas (${artists.length})</button>
    </div>

    <div class="search-tab-content active" id="search-tab-tracks">
      ${tracks.length === 0 
        ? '<p style="color:var(--text-muted);">Nenhuma música encontrada.</p>'
        : `<div class="music-grid">${tracks.map(t => renderMusicGridCard(t, 'track')).join('')}</div>`
      }
    </div>

    <div class="search-tab-content" id="search-tab-albums" style="display:none;">
      ${albums.length === 0 
        ? '<p style="color:var(--text-muted);">Nenhum álbum encontrado.</p>'
        : `<div class="music-grid">${albums.map(a => renderMusicGridCard(a, 'album')).join('')}</div>`
      }
    </div>

    <div class="search-tab-content" id="search-tab-artists" style="display:none;">
      ${artists.length === 0 
        ? '<p style="color:var(--text-muted);">Nenhum artista encontrado.</p>'
        : `<div class="music-grid">${artists.map(art => renderMusicGridCard(art, 'artist')).join('')}</div>`
      }
    </div>
  `;

  document.querySelectorAll('[data-search-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-search-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-search-tab');
      document.querySelectorAll('.search-tab-content').forEach(el => el.style.display = 'none');
      document.getElementById(`search-tab-${target}`).style.display = 'block';
    });
  });

  setupCardActionListeners();
}

// 5.4 VIEW: DETALHES DO ITEM
async function renderDetailsView(container, type, id) {
  const [details, reviews] = await Promise.all([
    apiFetch(`/api/spotify/${type}s/${id}`),
    apiFetch(`/api/reviews?itemId=${id}`)
  ]);

  let coverImg = 'https://placehold.co/300';
  if (details.images && details.images.length > 0) coverImg = details.images[0].url;
  else if (details.album && details.album.images && details.album.images.length > 0) coverImg = details.album.images[0].url;

  const name = details.name;
  const artistName = type === 'artist' ? '' : (details.artists ? details.artists.map(a => a.name).join(', ') : '');

  const totalRatings = reviews.length;
  const averageRating = totalRatings > 0 ? (reviews.reduce((acc, r) => acc + r.rating, 0) / totalRatings).toFixed(1) : 'S/N';
  const totalLikes = reviews.filter(r => r.liked).length;

  const distribution = {
    '0.5': reviews.filter(r => r.rating === 0.5).length,
    '1.0': reviews.filter(r => r.rating === 1.0).length,
    '1.5': reviews.filter(r => r.rating === 1.5).length,
    '2.0': reviews.filter(r => r.rating === 2.0).length,
    '2.5': reviews.filter(r => r.rating === 2.5).length,
    '3.0': reviews.filter(r => r.rating === 3.0).length,
    '3.5': reviews.filter(r => r.rating === 3.5).length,
    '4.0': reviews.filter(r => r.rating === 4.0).length,
    '4.5': reviews.filter(r => r.rating === 4.5).length,
    '5.0': reviews.filter(r => r.rating === 5.0).length
  };

  const maxInDist = Math.max(...Object.values(distribution), 1);
  const typeLabel = type === 'track' ? 'Música' : (type === 'album' ? 'Álbum' : 'Artista');

  let extraContentHtml = '';
  if (type === 'album' && details.tracks && details.tracks.items) {
    extraContentHtml = `
      <div class="tracklist-container">
        <h3 class="tracklist-title">Faixas do Álbum</h3>
        ${details.tracks.items.map(t => `
          <div class="track-row" onclick="navigateTo('/track/${t.id}')">
            <div class="track-row-left">
              <span class="track-num">${t.track_number}</span>
              <span class="track-name">${t.name}</span>
            </div>
            <span class="track-duration">${formatDuration(t.duration_ms)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } else if (type === 'artist') {
    const topTracks = await apiFetch(`/api/spotify/artists/${id}/top-tracks`);
    extraContentHtml = `
      <div class="tracklist-container">
        <h3 class="tracklist-title">Músicas mais Populares</h3>
        ${(topTracks.tracks || []).slice(0, 8).map((t, idx) => `
          <div class="track-row" onclick="navigateTo('/track/${t.id}')">
            <div class="track-row-left">
              <span class="track-num">${idx + 1}</span>
              <span class="track-name">${t.name}</span>
            </div>
            <span class="track-duration">${formatDuration(t.duration_ms)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  const embedType = type === 'track' ? 'track' : (type === 'album' ? 'album' : 'artist');
  const embedHtml = `
    <div class="spotify-embed-container">
      <iframe src="https://open.spotify.com/embed/${embedType}/${id}?utm_source=generator&theme=0" width="100%" height="${type === 'track' ? '80' : '380'}" frameborder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
    </div>
  `;

  // Layout das ações para usuários logados vs deslogados
  const actionsHtml = isLoggedIn()
    ? `
      <button class="btn btn-primary action-btn-main" id="details-log-btn"><i class="fa-solid fa-pen"></i> Avaliar / Log</button>
      <button class="btn btn-secondary action-btn-main" id="details-playlist-btn"><i class="fa-solid fa-plus"></i> Add à Playlist</button>
    `
    : `
      <button class="btn btn-primary action-btn-main" id="details-guest-log-btn"><i class="fa-solid fa-right-to-bracket"></i> Entre para Avaliar</button>
    `;

  container.innerHTML = `
    <div class="details-container">
      <div class="details-sidebar-left">
        <img src="${coverImg}" class="details-cover ${type === 'artist' ? 'artist-round' : ''}" alt="${name}">
        ${type !== 'artist' ? embedHtml : ''}
      </div>

      <div class="details-main-content">
        <div class="details-header">
          <span class="details-type-badge">${typeLabel}</span>
          <h1 class="details-title">${name}</h1>
          ${artistName ? `<div class="details-artist-row">de <a href="/artist/${details.artists[0].id}">${artistName}</a></div>` : ''}
          <div class="details-meta-row">
            ${details.release_date ? `<span>Lançamento: ${formatReleaseDate(details.release_date, details.release_date_precision)}</span>` : ''}
            ${details.total_tracks ? `<span>${details.total_tracks} faixas</span>` : ''}
            ${details.followers ? `<span>${details.followers.total.toLocaleString()} seguidores</span>` : ''}
          </div>
        </div>

        ${extraContentHtml}

        <div class="section-header" style="margin-top: 40px; margin-bottom: 16px;">
          <h3 class="section-title"><i class="fa-solid fa-comments"></i> Opinião da Comunidade (${totalRatings})</h3>
        </div>
        <div class="reviews-list">
          ${reviews.length === 0
            ? '<div class="glassmorphism" style="padding: 30px; text-align:center; color: var(--text-muted); border-radius: var(--border-radius-md);">Nenhuma review escrita para este item ainda. Seja o primeiro a escrever no Supabase!</div>'
            : reviews.map(r => renderReviewRowCard(r)).join('')
          }
        </div>
      </div>

      <div class="details-sidebar-right">
        <div class="action-box glassmorphism">
          ${actionsHtml}
          
          <div class="action-stats">
            <div class="action-stat-row"><span>Nota Média:</span><strong>${averageRating} ★</strong></div>
            <div class="action-stat-row"><span>Curtidas:</span><span><i class="fa-solid fa-heart"></i> ${totalLikes}</span></div>
            <div class="action-stat-row"><span>Avaliações:</span><span>${totalRatings}</span></div>
          </div>
        </div>

        <div class="rating-histogram-box glassmorphism">
          <h4 class="histogram-title">Distribuição de Notas</h4>
          <div class="histogram-chart">
            ${Object.entries(distribution).map(([score, count]) => {
              const heightPct = count > 0 ? (count / maxInDist) * 100 : 2;
              return `<div class="histogram-bar" style="height: ${heightPct}%" data-score="${score}" data-count="${count}"></div>`;
            }).join('')}
          </div>
          <div class="histogram-labels">
            <span>0.5★</span>
            <span>5.0★</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Ouvintes das ações
  if (isLoggedIn()) {
    document.getElementById('details-log-btn').addEventListener('click', () => {
      openLogModal({ id, type, name, artist: artistName, image: coverImg });
    });

    document.getElementById('details-playlist-btn').addEventListener('click', () => {
      if (type !== 'track') {
        showToast('Apenas faixas/músicas individuais podem ser inseridas em playlists.', 'warning');
        return;
      }
      openPlaylistModalWithTrack({
        id,
        name,
        artist: artistName,
        image: coverImg,
        duration: formatDuration(details.duration_ms)
      });
    });
  } else {
    document.getElementById('details-guest-log-btn').addEventListener('click', () => {
      showToast('Por favor, faça login ou cadastre-se para poder avaliar músicas!', 'info');
      openAuthModal('login');
    });
  }
}

// 5.5 VIEW: PLAYLISTS
async function renderPlaylistsView(container) {
  const playlists = await apiFetch(`/api/playlists?username=${STATE.currentUser.username}`);

  container.innerHTML = `
    <div class="section-header" style="margin-top: 20px;">
      <div>
        <h2 class="section-title"><i class="fa-solid fa-list-ul"></i> Suas Playlists</h2>
        <p style="color:var(--text-secondary); font-size:14px; margin-top: 4px;">Crie listas personalizadas conectadas à sua conta.</p>
      </div>
      <button class="btn btn-primary" id="btn-create-playlist"><i class="fa-solid fa-plus"></i> Criar Nova Playlist</button>
    </div>

    ${playlists.length === 0
      ? `
        <div class="glassmorphism" style="padding: 60px 20px; text-align: center; border-radius: var(--border-radius-lg); margin-top: 20px;">
          <i class="fa-solid fa-list-ul" style="font-size: 50px; color: var(--text-muted); margin-bottom: 20px;"></i>
          <h3>Nenhuma playlist cadastrada</h3>
          <p style="color: var(--text-secondary); margin-top: 8px;">Crie sua primeira playlist e organize seu repertório musical no Supabase!</p>
          <button class="btn btn-primary" onclick="openPlaylistModal()" style="margin-top: 20px;">Criar Playlist</button>
        </div>
      `
      : `
        <div class="music-grid">
          ${playlists.map(p => `
            <div class="music-card" onclick="navigateTo('/playlists/${p.id}')" style="cursor:pointer;">
              <div class="card-image-wrap">
                <div class="playlist-banner-cover" style="width:100%; height:100%; font-size: 40px; border-radius:0;">
                  <i class="fa-solid fa-music"></i>
                </div>
              </div>
              <div class="card-info">
                <span class="card-title">${escapeHTML(p.name)}</span>
                <span class="card-artist">${p.tracks.length} músicas</span>
                <div class="card-meta">
                  <span class="card-badge" style="color: var(--color-green); border-color: rgba(0, 224, 84, 0.2);">Playlist</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `
    }
  `;

  document.getElementById('btn-create-playlist')?.addEventListener('click', () => openPlaylistModal());
}

// 5.6 VIEW: DETALHES DE UMA PLAYLIST
async function renderPlaylistDetailsView(container, playlistId) {
  const playlist = await apiFetch(`/api/playlists/${playlistId}`);
  const isOwner = playlist.username.toLowerCase() === STATE.currentUser.username.toLowerCase();

  const actionButtons = isOwner
    ? `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-secondary" id="btn-edit-playlist"><i class="fa-solid fa-pencil"></i> Editar</button>
        <button class="btn btn-secondary" id="btn-delete-playlist" style="color: #ff4d4d; border-color: rgba(255, 77, 77, 0.2);"><i class="fa-solid fa-trash"></i> Excluir</button>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="playlist-banner-header glassmorphism">
      <div class="playlist-banner-cover"><i class="fa-solid fa-compact-disc"></i></div>
      <div class="playlist-banner-info">
        <h2>${escapeHTML(playlist.name)}</h2>
        <p class="playlist-banner-desc">${escapeHTML(playlist.description) || 'Sem descrição cadastrada.'}</p>
        <div class="playlist-banner-author">
          <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${playlist.username}" class="review-avatar" alt="Criador">
          <span>Criado por <strong>${escapeHTML(playlist.username)}</strong></span>
          <span>•</span>
          <span>${playlist.tracks.length} músicas</span>
        </div>
      </div>
      ${actionButtons}
    </div>

    <div class="tracklist-container glassmorphism" style="padding: 20px; border-radius: var(--border-radius-lg);">
      <h3 class="tracklist-title">Músicas da Lista</h3>
      ${playlist.tracks.length === 0
        ? '<p class="empty-list-message" style="padding: 30px 0;">Esta playlist está vazia.</p>'
        : playlist.tracks.map((t, idx) => `
          <div class="track-row" onclick="navigateTo('/track/${t.id}')">
            <div class="track-row-left">
              <span class="track-num">${idx + 1}</span>
              <img src="${t.image}" style="width: 32px; height:32px; object-fit:cover; border-radius:4px;" alt="Capa">
              <div>
                <span class="track-name">${t.name}</span>
                <div style="font-size:11px; color:var(--text-secondary);">${t.artist}</div>
              </div>
            </div>
            <span class="track-duration">${t.duration}</span>
          </div>
        `).join('')
      }
    </div>
  `;

  if (isOwner) {
    document.getElementById('btn-edit-playlist').addEventListener('click', () => openPlaylistModal(playlist));
    document.getElementById('btn-delete-playlist').addEventListener('click', async () => {
      if (confirm('Tem certeza de que deseja deletar esta playlist permanentemente?')) {
        await apiFetch(`/api/playlists/${playlistId}`, { method: 'DELETE' });
        showToast('Playlist deletada.', 'info');
        navigateTo('/playlists');
      }
    });
  }
}

// 5.7 VIEW: PERFIL DO USUÁRIO
async function renderProfileView(container, username) {
  const profileData = await apiFetch(`/api/profile/${username}`);
  const user = profileData.user;
  const stats = profileData.stats;

  const [reviews, playlists] = await Promise.all([
    apiFetch(`/api/reviews?username=${username}`),
    apiFetch(`/api/playlists?username=${username}`)
  ]);

  const maxInDist = Math.max(...Object.values(stats.ratingsDistribution), 1);
  const isMe = STATE.currentUser && username.toLowerCase() === STATE.currentUser.username.toLowerCase();

  const favTracks = user.favorites?.tracks || [];
  const favAlbums = user.favorites?.albums || [];

  container.innerHTML = `
    <div class="profile-header-card glassmorphism">
      <img src="${user.avatar}" class="profile-avatar-big" alt="${user.displayName}">
      <div class="profile-info-wrap">
        <div class="profile-name-row">
          <h2 class="profile-name">${escapeHTML(user.displayName)}</h2>
          <span class="profile-username">@${escapeHTML(user.username)}</span>
        </div>
        <p class="profile-bio">${escapeHTML(user.bio) || 'Sem biografia escrita ainda.'}</p>
      </div>
      ${isMe ? '<button class="btn btn-secondary" id="btn-edit-profile"><i class="fa-solid fa-pencil"></i> Editar Perfil</button>' : ''}
    </div>

    <div class="profile-stats-row">
      <div class="stat-card glassmorphism">
        <div class="stat-val">${stats.totalReviews}</div>
        <div class="stat-label">Avaliações</div>
      </div>
      <div class="stat-card glassmorphism">
        <div class="stat-val"><i class="fa-solid fa-heart"></i> ${stats.totalLikes}</div>
        <div class="stat-label">Curtidas</div>
      </div>
      <div class="stat-card glassmorphism">
        <div class="stat-val">${playlists.length}</div>
        <div class="stat-label">Playlists</div>
      </div>
      
      <div class="stat-card glassmorphism" style="display:flex; flex-direction:column; padding: 10px;">
        <div class="histogram-chart" style="height:40px; margin-bottom: 2px;">
          ${Object.entries(stats.ratingsDistribution).map(([score, count]) => {
            const heightPct = count > 0 ? (count / maxInDist) * 100 : 2;
            return `<div class="histogram-bar" style="height: ${heightPct}%" data-score="${score}" data-count="${count}"></div>`;
          }).join('')}
        </div>
        <div class="stat-label" style="font-size:10px;">Notas Logadas</div>
      </div>
    </div>

    <!-- Favoritos destacados -->
    <div class="favorites-row-section">
      <div class="section-header" style="margin-top: 0; margin-bottom: 16px;">
        <h3 class="section-title"><i class="fa-solid fa-star"></i> Destaques do Perfil</h3>
      </div>
      
      <div class="favorites-grid">
        ${[...favTracks, ...favAlbums].slice(0, 5).map(item => `
          <div class="music-card" onclick="navigateTo('/${item.type}/${item.id}')" style="cursor:pointer; padding:8px;">
            <div class="card-image-wrap" style="margin-bottom:6px;">
              <img src="${item.image}" class="card-image" alt="${item.name}">
            </div>
            <div class="card-info">
              <span class="card-title" style="font-size:12px; margin-bottom:2px;">${item.name}</span>
              <span class="card-artist" style="font-size:10px;">${item.artist}</span>
            </div>
          </div>
        `).join('')}
        ${[...favTracks, ...favAlbums].length === 0 
          ? '<div class="glassmorphism" style="grid-column: 1 / -1; padding: 25px; text-align:center; color: var(--text-muted); border-radius: var(--border-radius-md);">Nenhum item destacado no perfil ainda. Clique no coração das músicas para destacá-las aqui!</div>' 
          : ''
        }
      </div>
    </div>

    <div class="profile-tabs">
      <button class="tab-btn active" data-profile-tab="reviews">Avaliações (${reviews.length})</button>
      <button class="tab-btn" data-profile-tab="playlists">Playlists (${playlists.length})</button>
    </div>

    <div class="profile-tab-content active" id="profile-tab-reviews">
      <div class="reviews-list">
        ${reviews.length === 0
          ? '<p style="color:var(--text-muted); text-align:center; padding: 30px;">Nenhuma avaliação adicionada.</p>'
          : reviews.map(r => renderReviewRowCard(r)).join('')
        }
      </div>
    </div>

    <div class="profile-tab-content" id="profile-tab-playlists" style="display:none;">
      ${playlists.length === 0
        ? '<p style="color:var(--text-muted); text-align:center; padding: 30px;">Nenhuma playlist criada.</p>'
        : `
          <div class="music-grid">
            ${playlists.map(p => `
              <div class="music-card" onclick="navigateTo('/playlists/${p.id}')" style="cursor:pointer;">
                <div class="card-image-wrap">
                  <div class="playlist-banner-cover" style="width:100%; height:100%; font-size: 40px; border-radius:0;">
                    <i class="fa-solid fa-music"></i>
                  </div>
                </div>
                <div class="card-info">
                  <span class="card-title">${escapeHTML(p.name)}</span>
                  <span class="card-artist">${p.tracks.length} músicas</span>
                </div>
              </div>
            `).join('')}
          </div>
        `
      }
    </div>
  `;

  document.querySelectorAll('[data-profile-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-profile-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-profile-tab');
      document.querySelectorAll('.profile-tab-content').forEach(el => el.style.display = 'none');
      document.getElementById(`profile-tab-${target}`).style.display = 'block';
    });
  });

  if (isMe) {
    document.getElementById('btn-edit-profile').addEventListener('click', () => {
      openProfileModal(user);
    });
  }
}

// ==========================================
// 6. EVENTOS DO MODAL DE AUTENTICAÇÃO E LOGIN
// ==========================================

function openAuthModal(defaultTab = 'login') {
  const modal = document.getElementById('auth-modal');
  const loginTab = document.getElementById('auth-login-tab');
  const signupTab = document.getElementById('auth-signup-tab');
  const loginForm = document.getElementById('auth-login-form');
  const signupForm = document.getElementById('auth-signup-form');

  // Limpar formulários
  loginForm.reset();
  signupForm.reset();

  if (defaultTab === 'login') {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
  } else {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupForm.classList.add('active');
    loginForm.classList.remove('active');
  }

  openOverlay('auth-modal');
}

function setupAuthTabSwitching() {
  const loginTab = document.getElementById('auth-login-tab');
  const signupTab = document.getElementById('auth-signup-tab');
  const loginForm = document.getElementById('auth-login-form');
  const signupForm = document.getElementById('auth-signup-form');

  loginTab.addEventListener('click', () => {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
  });

  signupTab.addEventListener('click', () => {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupForm.classList.add('active');
    loginForm.classList.remove('active');
  });

  document.getElementById('auth-modal-close').addEventListener('click', () => closeOverlay('auth-modal'));
}

function setupModalListeners() {
  // Submit Formulário de LOGIN
  const loginForm = document.getElementById('auth-login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.user));
        STATE.currentUser = data.user;
        closeOverlay('auth-modal');
        showToast(`Bem-vindo, ${data.user.displayName}!`, 'success');
        
        renderHeaderNavigation();
        navigateTo('/');
      }
    } catch (err) {
      // API fetch handles error toast
    }
  });

  // Submit Formulário de CADASTRO
  const signupForm = document.getElementById('auth-signup-form');
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('signup-username').value;
    const displayName = document.getElementById('signup-name').value;
    const password = document.getElementById('signup-password').value;

    try {
      const data = await apiFetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, password })
      });

      if (data.success) {
        // Auto-login após cadastro
        localStorage.setItem('user', JSON.stringify(data.user));
        STATE.currentUser = data.user;
        closeOverlay('auth-modal');
        showToast('Cadastro realizado com sucesso!', 'success');
        
        renderHeaderNavigation();
        navigateTo('/');
      }
    } catch (err) {
      // API fetch handles error toast
    }
  });

  // Modal de Logs Close
  document.getElementById('log-modal-close').addEventListener('click', () => closeOverlay('log-modal'));
  
  const logForm = document.getElementById('log-form');
  logForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) {
      showToast('Por favor, conecte-se para poder avaliar.', 'warning');
      return;
    }

    const rating = STATE.activeRating;
    if (rating === 0) {
      showToast('Nota inválida. Selecione de 0.5 a 5.0 estrelas.', 'warning');
      return;
    }

    const payload = {
      username: STATE.currentUser.username,
      itemId: document.getElementById('log-item-id').value,
      itemType: document.getElementById('log-item-type').value,
      itemName: document.getElementById('log-item-name').textContent,
      itemArtist: document.getElementById('log-item-artist').textContent.replace('de ', ''),
      itemImage: document.getElementById('log-item-image').value,
      rating: rating,
      liked: document.getElementById('log-liked').checked,
      reviewText: document.getElementById('log-review').value,
      dateLogged: document.getElementById('log-date').value
    };

    await apiFetch('/api/reviews', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    closeOverlay('log-modal');
    showToast('Avaliação gravada no Supabase!', 'success');
    renderView(STATE.currentView, STATE.routeParams);
  });

  document.getElementById('log-delete-btn').addEventListener('click', async () => {
    const itemId = document.getElementById('log-item-id').value;
    if (confirm('Deseja realmente remover esta avaliação?')) {
      const userReviews = await apiFetch(`/api/reviews?username=${STATE.currentUser.username}&itemId=${itemId}`);
      if (userReviews.length > 0) {
        await apiFetch(`/api/reviews/${userReviews[0].id}`, { method: 'DELETE' });
        closeOverlay('log-modal');
        showToast('Avaliação excluída.', 'info');
        renderView(STATE.currentView, STATE.routeParams);
      }
    }
  });

  // Modal de Editar Perfil Close e Submit
  document.getElementById('profile-modal-close').addEventListener('click', () => closeOverlay('profile-modal'));
  document.getElementById('profile-cancel-btn').addEventListener('click', () => closeOverlay('profile-modal'));
  
  const profileForm = document.getElementById('profile-form');
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('profile-name').value;
    const bio = document.getElementById('profile-bio').value;

    await apiFetch(`/api/profile/${STATE.currentUser.username}/edit`, {
      method: 'POST',
      body: JSON.stringify({ displayName, bio })
    });

    // Atualizar sessão local do usuário
    STATE.currentUser.displayName = displayName;
    STATE.currentUser.bio = bio;
    localStorage.setItem('user', JSON.stringify(STATE.currentUser));

    closeOverlay('profile-modal');
    showToast('Perfil atualizado!', 'success');
    renderView(STATE.currentView, STATE.routeParams);
  });

  // Modal de Criar/Editar Playlist Close e Submit
  document.getElementById('playlist-modal-close').addEventListener('click', () => closeOverlay('playlist-modal'));
  document.getElementById('playlist-cancel-btn').addEventListener('click', () => closeOverlay('playlist-modal'));

  const playlistForm = document.getElementById('playlist-form');
  playlistForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('playlist-edit-id').value;
    const name = document.getElementById('playlist-name-input').value;
    const description = document.getElementById('playlist-desc-input').value;

    const payload = {
      username: STATE.currentUser.username,
      name,
      description,
      tracks: STATE.playlistTracks
    };
    if (id) payload.id = id;

    const response = await apiFetch('/api/playlists', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    closeOverlay('playlist-modal');
    showToast(id ? 'Playlist atualizada!' : 'Playlist salva no Supabase!', 'success');
    navigateTo(`/playlists/${response.playlist.id}`);
  });

  setupPlaylistTrackSearch();
}

function setupCardActionListeners() {
  document.querySelectorAll('.music-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const type = card.getAttribute('data-type');
    const name = card.getAttribute('data-name');
    const artist = card.getAttribute('data-artist');
    const image = card.getAttribute('data-image');

    card.querySelector('.btn-log')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isLoggedIn()) {
        showToast('Faça login para poder avaliar qualquer música!', 'info');
        openAuthModal('login');
        return;
      }
      openLogModal({ id, type, name, artist, image });
    });

    const favBtn = card.querySelector('.btn-favorite');
    if (!favBtn) return;

    checkIfFavorited(id, type).then(isFav => {
      if (isFav) {
        favBtn.querySelector('i').className = 'fa-solid fa-heart';
        favBtn.classList.add('btn-like-active');
      }
    });

    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isLoggedIn()) {
        showToast('Inicie uma sessão para destacar músicas no seu perfil!', 'info');
        openAuthModal('login');
        return;
      }
      try {
        const response = await apiFetch(`/api/profile/${STATE.currentUser.username}/favorites`, {
          method: 'POST',
          body: JSON.stringify({ id, name, artist, image, type })
        });
        
        if (response.favorited) {
          favBtn.querySelector('i').className = 'fa-solid fa-heart';
          favBtn.classList.add('btn-like-active');
          showToast('Adicionado aos Destaques!', 'success');
        } else {
          favBtn.querySelector('i').className = 'fa-regular fa-heart';
          favBtn.classList.remove('btn-like-active');
          showToast('Removido dos Destaques.', 'info');
        }
      } catch (err) {
        // Limit handles error toast
      }
    });
  });
}

async function checkIfFavorited(id, type) {
  if (!isLoggedIn()) return false;
  try {
    const profile = await apiFetch(`/api/profile/${STATE.currentUser.username}`);
    const listName = type === 'track' ? 'tracks' : (type === 'album' ? 'albums' : 'artists');
    const favList = profile.user.favorites?.[listName] || [];
    return favList.some(item => item.id === id);
  } catch (err) {
    return false;
  }
}

// 6.1 ABRE MODAL DE AVALIAÇÃO
async function openLogModal(item) {
  document.getElementById('log-item-id').value = item.id;
  document.getElementById('log-item-type').value = item.type;
  document.getElementById('log-item-image').value = item.image;
  document.getElementById('log-item-cover').src = item.image;
  document.getElementById('log-item-name').textContent = item.name;
  document.getElementById('log-item-artist').textContent = item.artist ? `de ${item.artist}` : '';
  
  const typeBadge = document.getElementById('log-item-badge');
  typeBadge.textContent = item.type === 'track' ? 'Música' : (item.type === 'album' ? 'Álbum' : 'Artista');

  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('log-date').value = todayStr;

  STATE.activeRating = 0;
  updateStarsUI(0);
  document.getElementById('log-liked').checked = false;
  document.getElementById('heart-icon').className = 'fa-regular fa-heart';
  document.getElementById('log-review').value = '';
  document.getElementById('log-delete-btn').style.display = 'none';

  try {
    const existing = await apiFetch(`/api/reviews?username=${STATE.currentUser.username}&itemId=${item.id}`);
    if (existing.length > 0) {
      const rev = existing[0];
      STATE.activeRating = rev.rating;
      updateStarsUI(rev.rating);
      document.getElementById('log-liked').checked = rev.liked;
      document.getElementById('heart-icon').className = rev.liked ? 'fa-solid fa-heart active' : 'fa-regular fa-heart';
      document.getElementById('log-review').value = rev.reviewText;
      document.getElementById('log-date').value = rev.dateLogged;
      document.getElementById('log-delete-btn').style.display = 'block';
    }
  } catch (err) {
    // Silent
  }

  const heartIcon = document.getElementById('heart-icon');
  const likeCheckbox = document.getElementById('log-liked');
  const newHeart = heartIcon.cloneNode(true);
  heartIcon.parentNode.replaceChild(newHeart, heartIcon);

  newHeart.addEventListener('click', () => {
    likeCheckbox.checked = !likeCheckbox.checked;
    newHeart.className = likeCheckbox.checked ? 'fa-solid fa-heart active' : 'fa-regular fa-heart';
  });

  openOverlay('log-modal');
}

// 6.2 ABRE PERFIL EDIT
function openProfileModal(user) {
  document.getElementById('profile-name').value = user.displayName;
  document.getElementById('profile-bio').value = user.bio || '';
  openOverlay('profile-modal');
}

// 6.3 ABRE PLAYLISTS EDIT
function openPlaylistModal(playlist = null) {
  const title = document.getElementById('playlist-modal-title');
  const submitBtn = document.getElementById('playlist-submit-btn');

  if (playlist) {
    title.textContent = 'Editar Playlist';
    submitBtn.textContent = 'Atualizar Playlist';
    document.getElementById('playlist-edit-id').value = playlist.id;
    document.getElementById('playlist-name-input').value = playlist.name;
    document.getElementById('playlist-desc-input').value = playlist.description;
    STATE.playlistTracks = [...playlist.tracks];
  } else {
    title.textContent = 'Criar Playlist';
    submitBtn.textContent = 'Criar Playlist';
    document.getElementById('playlist-edit-id').value = '';
    document.getElementById('playlist-name-input').value = '';
    document.getElementById('playlist-desc-input').value = '';
    STATE.playlistTracks = [];
  }

  renderPlaylistTracksEditor();
  openOverlay('playlist-modal');
}

function openPlaylistModalWithTrack(track) {
  openPlaylistModal();
  STATE.playlistTracks.push(track);
  renderPlaylistTracksEditor();
}

function setupPlaylistTrackSearch() {
  const input = document.getElementById('playlist-track-search-input');
  const resultsContainer = document.getElementById('playlist-search-results');
  let searchTimer;

  if (!input) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimer);
    
    if (!query) {
      resultsContainer.style.display = 'none';
      return;
    }

    searchTimer = setTimeout(async () => {
      try {
        const results = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(query)}&type=track&limit=5`);
        renderPlaylistTrackAutocomplete(results.tracks?.items || []);
      } catch (err) {
        resultsContainer.style.display = 'none';
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.playlist-add-track-search')) {
      resultsContainer.style.display = 'none';
    }
  });
}

function renderPlaylistTrackAutocomplete(tracks) {
  const container = document.getElementById('playlist-search-results');
  container.innerHTML = '';

  if (tracks.length === 0) {
    container.innerHTML = '<div class="autocomplete-item"><p style="color:var(--text-muted); font-size:12px;">Nenhuma faixa</p></div>';
    container.style.display = 'block';
    return;
  }

  tracks.forEach(track => {
    let coverImg = 'https://placehold.co/60';
    if (track.album?.images?.length > 0) coverImg = track.album.images[0].url;
    const artist = track.artists.map(a => a.name).join(', ');

    const el = document.createElement('div');
    el.className = 'autocomplete-item';
    el.innerHTML = `
      <img src="${coverImg}" class="autocomplete-cover" alt="${track.name}">
      <div class="autocomplete-info">
        <div class="autocomplete-name" style="font-size:13px;">${track.name}</div>
        <div class="autocomplete-sub" style="font-size:11px;">${artist}</div>
      </div>
    `;

    el.addEventListener('click', () => {
      container.style.display = 'none';
      document.getElementById('playlist-track-search-input').value = '';
      
      const alreadyInList = STATE.playlistTracks.some(t => t.id === track.id);
      if (alreadyInList) {
        showToast('Música já inserida nesta playlist.', 'info');
        return;
      }

      STATE.playlistTracks.push({
        id: track.id,
        name: track.name,
        artist,
        image: coverImg,
        duration: formatDuration(track.duration_ms)
      });

      renderPlaylistTracksEditor();
    });

    container.appendChild(el);
  });

  container.style.display = 'block';
}

function renderPlaylistTracksEditor() {
  const container = document.getElementById('playlist-added-tracks-container');
  container.innerHTML = '';

  if (STATE.playlistTracks.length === 0) {
    container.innerHTML = '<p class="empty-list-message">Nenhuma música adicionada ainda.</p>';
    return;
  }

  STATE.playlistTracks.forEach((track, index) => {
    const el = document.createElement('div');
    el.className = 'playlist-track-row';
    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span style="font-size:11px; color:var(--text-muted); width:15px; text-align:right;">${index + 1}</span>
        <img src="${track.image}" style="width:28px; height:28px; object-fit:cover; border-radius:4px;" alt="Capa">
        <div style="min-width:0;">
          <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.name}</div>
          <div style="font-size:10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</div>
        </div>
      </div>
      <button type="button" class="playlist-track-remove" data-index="${index}"><i class="fa-solid fa-trash-can"></i></button>
    `;

    el.querySelector('.playlist-track-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      STATE.playlistTracks.splice(index, 1);
      renderPlaylistTracksEditor();
    });

    container.appendChild(el);
  });
}

// ==========================================
// 7. DETECÇÃO INTERATIVA DE MEIA-ESTRELA (MÓDULO RATING)
// ==========================================

function setupStarRatingSelector() {
  const starBtns = document.querySelectorAll('.star-btn');
  const ratingValueLabel = document.getElementById('rating-value');

  starBtns.forEach(btn => {
    const value = parseInt(btn.getAttribute('data-value'));

    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const isHalf = (e.clientX - rect.left) < (rect.width / 2);
      const score = isHalf ? value - 0.5 : value;
      
      highlightStarsUI(score);
      ratingValueLabel.textContent = `${score.toFixed(1)} ★`;
    });

    btn.addEventListener('mouseleave', () => {
      updateStarsUI(STATE.activeRating);
    });

    btn.addEventListener('click', (e) => {
      const rect = btn.getBoundingClientRect();
      const isHalf = (e.clientX - rect.left) < (rect.width / 2);
      const score = isHalf ? value - 0.5 : value;
      
      STATE.activeRating = score;
      updateStarsUI(score);
    });
  });
}

function highlightStarsUI(score) {
  const starBtns = document.querySelectorAll('.star-btn');
  starBtns.forEach(btn => {
    const value = parseInt(btn.getAttribute('data-value'));
    btn.className = 'fa-regular fa-star star-btn';
    
    if (value <= score) {
      btn.className = 'fa-solid fa-star star-btn filled highlighted';
    } else if (value - 0.5 === score) {
      btn.className = 'fa-solid fa-star-half-stroke star-btn filled highlighted';
    }
  });
}

function updateStarsUI(score) {
  const starBtns = document.querySelectorAll('.star-btn');
  const ratingValueLabel = document.getElementById('rating-value');
  
  if (score === 0) {
    ratingValueLabel.textContent = 'Sem nota';
    starBtns.forEach(btn => btn.className = 'fa-regular fa-star star-btn');
    return;
  }

  ratingValueLabel.textContent = `${score.toFixed(1)} ★`;

  starBtns.forEach(btn => {
    const value = parseInt(btn.getAttribute('data-value'));
    btn.className = 'fa-regular fa-star star-btn';
    
    if (value <= score) {
      btn.className = 'fa-solid fa-star star-btn filled';
    } else if (value - 0.5 === score) {
      btn.className = 'fa-solid fa-star-half-stroke star-btn filled';
    }
  });
}

// ==========================================
// 8. INTERFACING / MODAL HELPERS (Abre/Fecha)
// ==========================================

function openOverlay(id) {
  const modal = document.getElementById(id);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeOverlay(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// ==========================================
// 9. FORMATADORES DE DADOS (Utilitários)
// ==========================================

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatReleaseDate(dateStr, precision) {
  if (!dateStr) return '';
  if (precision === 'year') return dateStr;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ==========================================================================
// 11. SISTEMA SOCIAL: ABAS DE AMIGOS E CHAT COM PARTILHA DE PLAYLISTS
// ==========================================================================

async function renderSocialView(container) {
  container.innerHTML = `
    <div class="dashboard-hero" style="padding: 40px 0 30px 0; margin-bottom: 24px;">
      <h1 class="hero-title"><i class="fa-solid fa-user-group"></i> Painel <span>Social</span></h1>
      <p class="hero-subtitle">Conecte-se com seus amigos, converse e compartilhe suas playlists favoritas.</p>
    </div>

    <div class="social-layout">
      <!-- Coluna Esquerda: Amigos & Conversas -->
      <div class="social-sidebar">
        <div class="social-sidebar-header">
          <div class="social-tabs">
            <button class="social-tab-btn ${STATE.socialActiveTab === 'chats' ? 'active' : ''}" id="social-tab-chats">Conversas</button>
            <button class="social-tab-btn ${STATE.socialActiveTab === 'friends' ? 'active' : ''}" id="social-tab-friends">Buscar Amigos</button>
          </div>
          <div class="sidebar-search-wrap">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" class="form-input sidebar-search-input" id="social-sidebar-search" placeholder="${STATE.socialActiveTab === 'chats' ? 'Filtrar conversas...' : 'Pesquisar novos amigos...'}">
          </div>
        </div>
        <div class="sidebar-list" id="social-sidebar-list">
          <div class="spinner-small" style="margin: 20px auto;"></div>
        </div>
      </div>

      <!-- Coluna Direita: Janela de Chat -->
      <div class="chat-window" id="social-chat-window">
        <!-- Renderizado dinamicamente -->
      </div>
    </div>
  `;

  // Setup tab event listeners
  document.getElementById('social-tab-chats').addEventListener('click', () => {
    STATE.socialActiveTab = 'chats';
    STATE.activeChatFriend = null;
    if (STATE.chatPollingInterval) {
      clearInterval(STATE.chatPollingInterval);
      STATE.chatPollingInterval = null;
    }
    renderSocialView(container);
  });

  document.getElementById('social-tab-friends').addEventListener('click', () => {
    STATE.socialActiveTab = 'friends';
    STATE.activeChatFriend = null;
    if (STATE.chatPollingInterval) {
      clearInterval(STATE.chatPollingInterval);
      STATE.chatPollingInterval = null;
    }
    renderSocialView(container);
  });

  // Setup search input listener
  const searchInput = document.getElementById('social-sidebar-search');
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (STATE.socialActiveTab === 'friends') {
      // Debounce user search
      clearTimeout(STATE.searchDebounceTimer);
      STATE.searchDebounceTimer = setTimeout(() => {
        loadSocialSidebarList(query);
      }, 300);
    } else {
      // Direct filter chats in DOM or reload
      loadSocialSidebarList(query);
    }
  });

  // Load initial sidebar list and chat window
  await loadSocialSidebarList();
  renderChatWindow();
}

async function loadSocialSidebarList(filterQuery = '') {
  const listContainer = document.getElementById('social-sidebar-list');
  if (!listContainer) return;

  const currentUsername = STATE.currentUser.username;

  try {
    // 1. Fetch current friendships
    const friendships = await apiFetch(`/api/friends/list?username=${currentUsername}`);
    
    if (STATE.socialActiveTab === 'chats') {
      // Show accepted friends to chat with
      const acceptedFriendships = friendships.filter(f => f.status === 'accepted');
      
      let friendsList = acceptedFriendships.map(f => {
        const friendUser = f.sender_username === currentUsername ? f.receiver_username : f.sender_username;
        return {
          username: friendUser,
          displayName: friendUser.charAt(0).toUpperCase() + friendUser.slice(1), // Fallback
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${friendUser}`
        };
      });

      // Filter locally by display name or username
      if (filterQuery) {
        const q = filterQuery.toLowerCase();
        friendsList = friendsList.filter(f => f.username.includes(q) || f.displayName.toLowerCase().includes(q));
      }

      if (friendsList.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 10px;">
            ${filterQuery ? 'Nenhum amigo encontrado.' : 'Você não possui nenhum amigo adicionado. Vá na aba <strong>"Buscar Amigos"</strong> para adicionar!'}
          </div>
        `;
        return;
      }

      listContainer.innerHTML = friendsList.map(friend => {
        const isActive = STATE.activeChatFriend === friend.username;
        return `
          <div class="sidebar-item ${isActive ? 'active' : ''}" data-chat-username="${friend.username}">
            <img src="${friend.avatar}" class="sidebar-avatar" alt="${friend.username}">
            <div class="sidebar-item-info">
              <div class="sidebar-item-name">${escapeHTML(friend.username)}</div>
              <div class="sidebar-item-sub">Clique para conversar</div>
            </div>
            <i class="fa-solid fa-chevron-right" style="font-size: 12px; color: var(--text-muted);"></i>
          </div>
        `;
      }).join('');

      // Setup click listeners for active chat friend selection
      listContainer.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
          const friendUsername = item.getAttribute('data-chat-username');
          if (STATE.activeChatFriend !== friendUsername) {
            STATE.activeChatFriend = friendUsername;
            
            // Highlight item in DOM
            listContainer.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            // Redraw chat window
            renderChatWindow();
          }
        });
      });

    } else {
      // TAB: Buscar Amigos & Gerenciar Solicitações
      if (filterQuery) {
        // Search users using API
        const results = await apiFetch(`/api/friends/search-users?q=${encodeURIComponent(filterQuery)}&currentUsername=${currentUsername}`);
        
        if (results.length === 0) {
          listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">Nenhum usuário encontrado.</div>`;
          return;
        }

        listContainer.innerHTML = results.map(user => {
          // Check relationship status
          const rel = friendships.find(f => 
            (f.sender_username === currentUsername && f.receiver_username === user.username) || 
            (f.sender_username === user.username && f.receiver_username === currentUsername)
          );

          let actionHtml = '';
          if (!rel) {
            actionHtml = `<button class="btn btn-primary btn-sm btn-action-add" data-username="${user.username}" style="padding: 4px 10px; font-size:11px;"><i class="fa-solid fa-user-plus"></i> Adicionar</button>`;
          } else if (rel.status === 'pending') {
            if (rel.sender_username === currentUsername) {
              actionHtml = `<span style="font-size:11px; color: var(--text-muted);"><i class="fa-solid fa-clock"></i> Pendente</span>`;
            } else {
              actionHtml = `
                <div style="display:flex; gap:4px;">
                  <button class="btn btn-primary btn-sm btn-action-accept" data-sender="${user.username}" style="padding: 4px 8px; font-size:10px; background:var(--color-green); color:#000;"><i class="fa-solid fa-check"></i></button>
                  <button class="btn btn-secondary btn-sm btn-action-decline" data-sender="${user.username}" style="padding: 4px 8px; font-size:10px;"><i class="fa-solid fa-xmark"></i></button>
                </div>
              `;
            }
          } else {
            actionHtml = `<span style="font-size:11px; color: var(--color-green); font-weight:600;"><i class="fa-solid fa-user-check"></i> Amigos</span>`;
          }

          return `
            <div class="sidebar-item" style="cursor: default;">
              <img src="${user.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}" class="sidebar-avatar" alt="${user.username}">
              <div class="sidebar-item-info">
                <div class="sidebar-item-name">${escapeHTML(user.username)}</div>
                <div class="sidebar-item-sub">${escapeHTML(user.display_name)}</div>
              </div>
              <div class="sidebar-item-action-wrap">
                ${actionHtml}
              </div>
            </div>
          `;
        }).join('');

        // Attach action button event listeners
        listContainer.querySelectorAll('.btn-action-add').forEach(btn => {
          btn.addEventListener('click', async () => {
            const username = btn.getAttribute('data-username');
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner-small" style="width:12px; height:12px; border-width:2px;"></div>';
            try {
              await apiFetch('/api/friends/request', {
                method: 'POST',
                body: JSON.stringify({ senderUsername: currentUsername, receiverUsername: username })
              });
              showToast('Solicitação de amizade enviada!', 'success');
              loadSocialSidebarList(filterQuery);
            } catch (err) {
              btn.disabled = false;
              btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Adicionar';
            }
          });
        });

        listContainer.querySelectorAll('.btn-action-accept').forEach(btn => {
          btn.addEventListener('click', async () => {
            const sender = btn.getAttribute('data-sender');
            try {
              await apiFetch('/api/friends/accept', {
                method: 'POST',
                body: JSON.stringify({ senderUsername: sender, receiverUsername: currentUsername })
              });
              showToast('Solicitação de amizade aceita!', 'success');
              loadSocialSidebarList(filterQuery);
            } catch (err) {}
          });
        });

        listContainer.querySelectorAll('.btn-action-decline').forEach(btn => {
          btn.addEventListener('click', async () => {
            const sender = btn.getAttribute('data-sender');
            try {
              await apiFetch('/api/friends/decline', {
                method: 'POST',
                body: JSON.stringify({ userA: sender, userB: currentUsername })
              });
              showToast('Solicitação recusada.', 'info');
              loadSocialSidebarList(filterQuery);
            } catch (err) {}
          });
        });

      } else {
        // Search query empty: Show Pending requests and Current Friends list
        const pendingReceived = friendships.filter(f => f.status === 'pending' && f.receiver_username === currentUsername);
        const accepted = friendships.filter(f => f.status === 'accepted');

        let html = '';

        if (pendingReceived.length > 0) {
          html += `<div style="font-size:11px; font-weight:700; color:var(--color-orange); text-transform:uppercase; margin: 10px 4px 6px 4px; letter-spacing:0.5px;"><i class="fa-solid fa-bell"></i> Solicitações Pendentes (${pendingReceived.length})</div>`;
          html += pendingReceived.map(req => {
            const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${req.sender_username}`;
            return `
              <div class="sidebar-item" style="cursor: default; border: 1px dashed var(--color-orange); background: rgba(255,128,0,0.02); margin-bottom:4px;">
                <img src="${avatar}" class="sidebar-avatar" alt="${req.sender_username}">
                <div class="sidebar-item-info">
                  <div class="sidebar-item-name">${escapeHTML(req.sender_username)}</div>
                  <div class="sidebar-item-sub">Quer ser seu amigo!</div>
                </div>
                <div style="display:flex; gap:4px;">
                  <button class="btn btn-primary btn-sm btn-action-accept" data-sender="${req.sender_username}" style="padding: 4px 8px; font-size:10px; background:var(--color-green); color:#000;"><i class="fa-solid fa-check"></i></button>
                  <button class="btn btn-secondary btn-sm btn-action-decline" data-sender="${req.sender_username}" style="padding: 4px 8px; font-size:10px;"><i class="fa-solid fa-xmark"></i></button>
                </div>
              </div>
            `;
          }).join('');
        }

        html += `<div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin: 16px 4px 6px 4px; letter-spacing:0.5px;">Seus Amigos (${accepted.length})</div>`;
        
        if (accepted.length === 0) {
          html += `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 10px;">Nenhum amigo na lista. Digite o nome de usuário no campo acima para encontrar novas pessoas!</div>`;
        } else {
          html += accepted.map(f => {
            const friendUser = f.sender_username === currentUsername ? f.receiver_username : f.sender_username;
            const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${friendUser}`;
            return `
              <div class="sidebar-item" style="cursor: default; margin-bottom:4px;">
                <img src="${avatar}" class="sidebar-avatar" alt="${friendUser}">
                <div class="sidebar-item-info">
                  <div class="sidebar-item-name">${escapeHTML(friendUser)}</div>
                  <div class="sidebar-item-sub">Amigo desde ${formatDate(f.created_at.split('T')[0])}</div>
                </div>
                <button class="btn btn-secondary btn-sm btn-action-unfriend" data-friend="${friendUser}" style="padding: 4px 8px; font-size:11px; color:var(--color-orange); border-color:transparent; background:transparent;" title="Remover Amigo"><i class="fa-solid fa-user-minus"></i></button>
              </div>
            `;
          }).join('');
        }

        listContainer.innerHTML = html;

        // Attach action listeners inside empty search
        listContainer.querySelectorAll('.btn-action-accept').forEach(btn => {
          btn.addEventListener('click', async () => {
            const sender = btn.getAttribute('data-sender');
            try {
              await apiFetch('/api/friends/accept', {
                method: 'POST',
                body: JSON.stringify({ senderUsername: sender, receiverUsername: currentUsername })
              });
              showToast('Solicitação de amizade aceita!', 'success');
              loadSocialSidebarList();
            } catch (err) {}
          });
        });

        listContainer.querySelectorAll('.btn-action-decline').forEach(btn => {
          btn.addEventListener('click', async () => {
            const sender = btn.getAttribute('data-sender');
            try {
              await apiFetch('/api/friends/decline', {
                method: 'POST',
                body: JSON.stringify({ userA: sender, userB: currentUsername })
              });
              showToast('Solicitação recusada.', 'info');
              loadSocialSidebarList();
            } catch (err) {}
          });
        });

        listContainer.querySelectorAll('.btn-action-unfriend').forEach(btn => {
          btn.addEventListener('click', async () => {
            const friend = btn.getAttribute('data-friend');
            if (confirm(`Tem certeza que deseja desfazer a amizade com ${friend}?`)) {
              try {
                await apiFetch('/api/friends/decline', {
                  method: 'POST',
                  body: JSON.stringify({ userA: friend, userB: currentUsername })
                });
                showToast('Amizade desfeita.', 'info');
                loadSocialSidebarList();
              } catch (err) {}
            }
          });
        });
      }
    }
  } catch (error) {
    listContainer.innerHTML = `<div style="text-align: center; color: var(--color-orange); padding: 20px;">Erro ao conectar com o servidor.</div>`;
  }
}

async function renderChatWindow() {
  const windowContainer = document.getElementById('social-chat-window');
  if (!windowContainer) return;

  // Clear previous polling loop first
  if (STATE.chatPollingInterval) {
    clearInterval(STATE.chatPollingInterval);
    STATE.chatPollingInterval = null;
  }

  if (!STATE.activeChatFriend) {
    windowContainer.innerHTML = `
      <div class="social-empty-state">
        <i class="fa-solid fa-comments"></i>
        <h3>Escolha um amigo para iniciar</h3>
        <p>Selecione um dos seus amigos da lista à esquerda para carregar o histórico do chat ou compartilhar músicas e playlists.</p>
      </div>
    `;
    return;
  }

  const friend = STATE.activeChatFriend;
  const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${friend}`;

  windowContainer.innerHTML = `
    <!-- Header do Chat -->
    <div class="chat-header">
      <img src="${avatar}" class="sidebar-avatar" alt="${friend}">
      <div class="chat-header-info">
        <h3>${escapeHTML(friend)}</h3>
        <p><i class="fa-solid fa-circle" style="color:var(--color-green); font-size:8px; margin-right:4px;"></i> Conversa direta conectada no Supabase</p>
      </div>
    </div>

    <!-- Lista de Mensagens -->
    <div class="chat-messages" id="chat-messages-container">
      <div class="spinner-small" style="margin: auto;"></div>
    </div>

    <!-- Área de Input -->
    <form class="chat-input-area" id="chat-send-form">
      <button type="button" class="chat-btn-share" id="chat-btn-share-playlist" title="Compartilhar Playlist"><i class="fa-solid fa-compact-disc"></i></button>
      <input type="text" class="form-input chat-input-text" id="chat-message-input" placeholder="Envie uma mensagem para ${friend}..." autocomplete="off" required>
      <button type="submit" class="chat-btn-send" title="Enviar Mensagem"><i class="fa-solid fa-paper-plane"></i></button>
    </form>
  `;

  // Attach send form submit listener
  const form = document.getElementById('chat-send-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-message-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    
    try {
      await apiFetch('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          senderUsername: STATE.currentUser.username,
          receiverUsername: friend,
          messageText: text
        })
      });
      // Refresh messages instantly
      await refreshChatMessages();
    } catch (err) {
      showToast('Erro ao enviar mensagem.', 'warning');
    }
  });

  // Attach share playlist click listener
  document.getElementById('chat-btn-share-playlist').addEventListener('click', () => {
    openSharePlaylistModal();
  });

  // Load messages initially and start polling
  await refreshChatMessages();
  
  // Set up dynamic polling every 3 seconds while chat window is active
  STATE.chatPollingInterval = setInterval(() => {
    if (STATE.currentView === 'social' && STATE.activeChatFriend === friend) {
      refreshChatMessages();
    } else {
      // Self-cleanup just in case
      clearInterval(STATE.chatPollingInterval);
      STATE.chatPollingInterval = null;
    }
  }, 3000);
}

async function refreshChatMessages() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  const currentUsername = STATE.currentUser.username;
  const friend = STATE.activeChatFriend;

  try {
    const messages = await apiFetch(`/api/chat/messages?user=${currentUsername}&friend=${friend}`);
    
    if (messages.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; margin: auto; padding: 40px; color: var(--text-muted); font-size:13px;">
          Nenhuma mensagem nesta conversa. Escreva a primeira mensagem ou envie uma playlist para quebrar o gelo! 🧊
        </div>
      `;
      return;
    }

    // Capture whether user is scrolled to bottom
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;

    container.innerHTML = messages.map(msg => {
      const isSent = msg.sender_username === currentUsername;
      const date = new Date(msg.created_at);
      const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      
      let playlistHtml = '';
      if (msg.playlist_id) {
        playlistHtml = `
          <div class="shared-playlist-card" data-shared-playlist-id="${msg.playlist_id}">
            <div class="playlist-card-icon"><i class="fa-solid fa-compact-disc"></i></div>
            <div class="playlist-card-info">
              <div class="playlist-card-name">Playlist Compartilhada</div>
              <div class="playlist-card-desc">Clique para ver as faixas</div>
            </div>
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:11px; margin-left:4px;"></i>
          </div>
        `;
      }

      return `
        <div class="message-bubble-wrap ${isSent ? 'sent' : 'received'}">
          <div class="message-bubble">
            ${msg.message_text ? `<div>${escapeHTML(msg.message_text)}</div>` : ''}
            ${playlistHtml}
          </div>
          <span class="message-time">${timeStr}</span>
        </div>
      `;
    }).join('');

    // Setup playlist click redirection listeners
    container.querySelectorAll('.shared-playlist-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-shared-playlist-id');
        navigateTo(`/playlists/${id}`);
      });
    });

    // Auto-scroll to bottom if they were already at the bottom or if it is the first load
    if (isAtBottom || container.querySelector('.spinner-small')) {
      container.scrollTop = container.scrollHeight;
    }

  } catch (error) {
    console.error('Refresh messages error:', error);
  }
}

async function openSharePlaylistModal() {
  const modal = document.getElementById('share-playlist-modal');
  const container = document.getElementById('share-playlist-list-container');
  if (!modal || !container) return;

  container.innerHTML = '<div class="spinner-small" style="margin: 20px auto;"></div>';
  modal.classList.add('active');

  // Close modal button setup
  const closeBtn = document.getElementById('share-playlist-modal-close');
  const closeModalFunc = () => {
    modal.classList.remove('active');
    closeBtn.removeEventListener('click', closeModalFunc);
  };
  closeBtn.addEventListener('click', closeModalFunc);

  try {
    const playlists = await apiFetch(`/api/playlists?username=${STATE.currentUser.username}`);
    
    if (playlists.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; color:var(--text-muted); font-size:13px; padding:20px;">
          Você não possui nenhuma playlist criada para compartilhar. Crie uma playlist primeiro na aba "Playlists"!
        </div>
      `;
      return;
    }

    container.innerHTML = playlists.map(playlist => {
      const tracksCount = playlist.tracks ? playlist.tracks.length : 0;
      return `
        <div class="share-playlist-item" data-share-id="${playlist.id}">
          <div>
            <h4>${escapeHTML(playlist.name)}</h4>
            <p>${tracksCount} música(s) • ${escapeHTML(playlist.description || 'Sem descrição')}</p>
          </div>
          <i class="fa-solid fa-paper-plane" style="color:var(--color-green); font-size: 14px;"></i>
        </div>
      `;
    }).join('');

    // Setup choose playlist click listeners
    container.querySelectorAll('.share-playlist-item').forEach(item => {
      item.addEventListener('click', async () => {
        const playlistId = item.getAttribute('data-share-id');
        modal.classList.remove('active');

        try {
          await apiFetch('/api/chat/messages', {
            method: 'POST',
            body: JSON.stringify({
              senderUsername: STATE.currentUser.username,
              receiverUsername: STATE.activeChatFriend,
              messageText: 'Olhe a minha playlist compartilhada!',
              playlistId: playlistId
            })
          });
          showToast('Playlist compartilhada no chat!', 'success');
          await refreshChatMessages();
        } catch (err) {
          showToast('Erro ao compartilhar playlist.', 'warning');
        }
      });
    });

  } catch (err) {
    container.innerHTML = '<div style="text-align:center; color:var(--color-orange); padding:20px;">Erro ao carregar suas playlists.</div>';
  }
}
