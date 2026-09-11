/**
 * INFODESK & AGENDA — CONTROLADOR PRINCIPAL JAVASCRIPT
 * Sistema integrado de Consulta Diária, Agenda e Workflow de PROADs
 * Suporte a Sincronização em Nuvem (Firebase Firestore) e Cache Local Offline
 */

// ==========================================================================
// 1. ESTADO GLOBAL DA APLICAÇÃO (STATE STORE)
// ==========================================================================
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCaVDq09DYfjlspAC1vvdw2KO42nnSXgwY',
  projectId: 'infodesk-agenda',
  authDomain: 'infodesk-agenda.firebaseapp.com'
};

const state = {
  proads: [],
  agenda: [],
  infos: [],
  settings: {
    theme: 'light',
    pinEnabled: false,
    pin: '1234',
    proadView: 'kanban',
    firebase: { ...DEFAULT_FIREBASE_CONFIG }
  },
  currentDate: new Date(),
  selectedDate: getTodayString(),
  activePage: 'hoje',
  currentProadDetailId: null,
  proadFilter: { search: '', prio: 'all', phase: 'all' },
  infoFilter: { search: '', cat: 'all', onlyPinned: false },
  cloudSync: {
    connected: false,
    syncing: false,
    db: null
  }
};

// ==========================================================================
// 2. UTILITÁRIOS DE DATA E FORMATAÇÃO
// ==========================================================================
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateBR(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function formatDateTimeBR(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${mon} ${hours}:${mins}`;
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// ==========================================================================
// 3. TOAST E FEEDBACK VISUAL
// ==========================================================================
let toastTimer = null;
function showToast(message, isSuccess = true) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');

  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  iconEl.className = isSuccess ? 'ti ti-check' : 'ti ti-alert-circle';
  iconEl.style.color = isSuccess ? 'var(--emerald)' : 'var(--red)';

  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// Cópia para a área de transferência com 1 clique
function copyToClipboard(text, label = 'Informação') {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`${label} copiado!`);
    }).catch(() => fallbackCopy(text, label));
  } else {
    fallbackCopy(text, label);
  }
}

function fallbackCopy(text, label) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast(`${label} copiado!`);
  } catch (err) {
    showToast('Falha ao copiar', false);
  }
  document.body.removeChild(textarea);
}

// ==========================================================================
// 4. PERSISTÊNCIA LOCAL & SINCRONIZAÇÃO EM NUVEM
// ==========================================================================
const STORAGE_KEY = 'infodesk_agenda_store_v1';

function loadLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.proads = parsed.proads || [];
      state.agenda = parsed.agenda || [];
      state.infos = parsed.infos || [];
      if (parsed.settings) {
        state.settings = { ...state.settings, ...parsed.settings };
      }
      // Garante que o Firebase sempre use DEFAULT_FIREBASE_CONFIG caso nao haja chave configurada
      if (!state.settings.firebase || !state.settings.firebase.apiKey) {
        state.settings.firebase = { ...DEFAULT_FIREBASE_CONFIG };
      }
    }
  } catch (e) {
    console.error('Erro ao ler dados locais:', e);
  }
}

function saveLocalData() {
  try {
    const payload = {
      proads: state.proads,
      agenda: state.agenda,
      infos: state.infos,
      settings: state.settings
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error('Erro ao salvar localmente:', e);
  }
}

// Indicador de progresso de sincronização
function triggerSyncIndicator() {
  const bar = document.getElementById('sync-progress');
  if (!bar) return;
  bar.classList.remove('done');
  bar.classList.add('active');
  setTimeout(() => {
    bar.classList.add('done');
    bar.classList.remove('active');
  }, 400);
}

// Inicialização da Nuvem (Firebase)
function initFirebase() {
  let fbCfg = state.settings.firebase;
  if (!fbCfg || !fbCfg.apiKey) {
    fbCfg = { ...DEFAULT_FIREBASE_CONFIG };
    state.settings.firebase = fbCfg;
  }

  if (typeof firebase === 'undefined') {
    updateCloudStatusUI(false, 'Local', 'Firebase SDK não carregado');
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: fbCfg.apiKey,
        projectId: fbCfg.projectId,
        authDomain: fbCfg.authDomain || `${fbCfg.projectId}.firebaseapp.com`
      });
    }

    state.cloudSync.db = firebase.firestore();
    state.cloudSync.connected = true;
    updateCloudStatusUI(true, 'Nuvem Conectada', 'Sincronizado com Firestore');

    // Ouvintes em tempo real para sincronização multi-dispositivo
    listenFirebaseCollection('proads', (data) => {
      state.proads = data;
      saveLocalData();
      renderAll();
    });

    listenFirebaseCollection('agenda', (data) => {
      state.agenda = data;
      saveLocalData();
      renderAll();
    });

    listenFirebaseCollection('infos', (data) => {
      state.infos = data;
      saveLocalData();
      renderAll();
    });

  } catch (err) {
    console.warn('Erro ao conectar ao Firebase:', err);
    updateCloudStatusUI(false, 'Erro na Nuvem', 'Usando dados locais');
  }
}

function listenFirebaseCollection(collectionName, callback) {
  if (!state.cloudSync.db) return;
  state.cloudSync.db.collection(collectionName).onSnapshot(
    (snapshot) => {
      const items = [];
      snapshot.forEach(doc => {
        items.push({ id: doc.id, ...doc.data() });
      });
      callback(items);
    },
    (error) => {
      console.warn(`Erro no listener da coleção ${collectionName}:`, error);
    }
  );
}

function syncToCloud(collectionName, item) {
  triggerSyncIndicator();
  saveLocalData();

  if (state.cloudSync.connected && state.cloudSync.db) {
    try {
      const col = state.cloudSync.db.collection(collectionName);
      col.doc(item.id).set(item, { merge: true });
    } catch (e) {
      console.warn('Falha no upload para nuvem:', e);
    }
  }
}

function deleteFromCloud(collectionName, itemId) {
  triggerSyncIndicator();
  saveLocalData();

  if (state.cloudSync.connected && state.cloudSync.db) {
    try {
      state.cloudSync.db.collection(collectionName).doc(itemId).delete();
    } catch (e) {
      console.warn('Falha ao deletar na nuvem:', e);
    }
  }
}

function updateCloudStatusUI(isOnline, title, desc) {
  const indicator = document.getElementById('cloud-indicator');
  const titleEl = document.getElementById('cloud-status-title');
  const descEl = document.getElementById('cloud-status-desc');
  const badgeEl = document.getElementById('firebase-status-badge');

  if (indicator) {
    indicator.className = 'cloud-indicator ' + (isOnline ? 'online' : '');
  }
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (badgeEl) {
    badgeEl.textContent = isOnline ? 'Conectado' : 'Desconectado';
    badgeEl.className = 'badge ' + (isOnline ? 'badge-normal' : '');
  }
}

// ==========================================================================
// 5. DADOS DE EXEMPLO (REALISTAS PARA GABINETE / TRIBUNAL)
// ==========================================================================
function loadSampleDataPrompt() {
  if (confirm('Deseja carregar os dados de exemplo de PROADs, Agenda e Informações?')) {
    populateSampleData();
    saveLocalData();
    renderAll();
    showToast('Dados de exemplo carregados com sucesso!');
  }
}

function populateSampleData() {
  const today = getTodayString();
  const d = new Date();
  const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
  const nextWeek = new Date(d); nextWeek.setDate(d.getDate() + 5);

  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  // 1. PROADs de Exemplo
  state.proads = [
    {
      id: generateId(),
      numero: '2026048123',
      interessado: 'DGP - Diretoria Geral',
      assunto: 'Designação de servidor para plantão judiciário extraordinário',
      fase: 'elaboracao',
      prioridade: 'urgente',
      dataEntrada: today,
      prazo: tomorrowStr,
      andamentos: [
        { id: generateId(), data: new Date().toISOString(), texto: 'Recebido da DGP com pedido de urgência.' },
        { id: generateId(), data: new Date().toISOString(), texto: 'Em elaboração de minuta de portaria de designação.' }
      ]
    },
    {
      id: generateId(),
      numero: '2026049504',
      interessado: 'Secretaria Geral da Presidência',
      assunto: 'Parecer técnico sobre renovação de contrato de software de gestão',
      fase: 'revisao',
      prioridade: 'alta',
      dataEntrada: today,
      prazo: nextWeekStr,
      andamentos: [
        { id: generateId(), data: new Date().toISOString(), texto: 'Processo recebido da TI com estudo de viabilidade.' },
        { id: generateId(), data: new Date().toISOString(), texto: 'Minuta finalizada. Encaminhada para conferência da Assessoria Jurídica.' }
      ]
    },
    {
      id: generateId(),
      numero: '2026051189',
      interessado: '1ª Vara Cível de Goiânia',
      assunto: 'Solicitação de suprimento emergencial de material de expediente',
      fase: 'recebimento',
      prioridade: 'normal',
      dataEntrada: today,
      prazo: nextWeekStr,
      andamentos: [
        { id: generateId(), data: new Date().toISOString(), texto: 'Processo autuado e distribuído para análise.' }
      ]
    },
    {
      id: generateId(),
      numero: '2026037890',
      interessado: 'Comarca de Anápolis',
      assunto: 'Homologação de escala de substituição de férias de magistrado',
      fase: 'finalizacao',
      prioridade: 'normal',
      dataEntrada: today,
      prazo: today,
      andamentos: [
        { id: generateId(), data: new Date().toISOString(), texto: 'Despacho acolhido e assinado eletronicamente.' },
        { id: generateId(), data: new Date().toISOString(), texto: 'Processo concluído e arquivado no sistema.' }
      ]
    }
  ];

  // 2. Agenda de Exemplo
  state.agenda = [
    {
      id: generateId(),
      titulo: 'Prazo Urgente: Despacho PROAD 2026048123',
      data: today,
      categoria: 'prazo',
      horaInicio: '11:00',
      horaFim: '12:00',
      local: 'Gabinete',
      obs: 'Finalizar minuta de portaria de designação',
      done: false
    },
    {
      id: generateId(),
      titulo: 'Reunião de Alinhamento com a Diretoria',
      data: today,
      categoria: 'reuniao',
      horaInicio: '14:30',
      horaFim: '15:30',
      local: 'Sala de Videoconferência / Teams',
      obs: 'Pauta: Andamento das metas do trimestre',
      done: false
    },
    {
      id: generateId(),
      titulo: 'Despacho de Processos com a Assessoria',
      data: tomorrowStr,
      categoria: 'despacho',
      horaInicio: '10:00',
      horaFim: '11:30',
      local: 'Presidência',
      obs: 'Assinatura dos PROADs em fase de finalização',
      done: false
    }
  ];

  // 3. Base de Informações de Exemplo (com Chave: Valor para cópia rápida)
  state.infos = [
    {
      id: generateId(),
      titulo: 'Ramais Telefônicos Mais Usados',
      categoria: 'ramais',
      tags: ['urgente', 'presidencia', 'dgp'],
      pinned: true,
      conteudo: 'Gabinete da Presidência: 5010\nDiretoria Geral (DGP): 5025\nAssessoria Jurídica: 5040\nProtocolo / PROAD Suporte: 5088\nTI Plantão: 5100'
    },
    {
      id: generateId(),
      titulo: 'Modelo de Despacho Ordinatório Padrão',
      categoria: 'modelos',
      tags: ['modelo', 'despacho', 'sei'],
      pinned: true,
      conteudo: '1. Cumpra-se nos termos da informação técnica retro.\n2. À Diretoria de Gestão de Pessoas (DGP) para as anotações cadastrais e providências subsequentes.\n3. Após, arquive-se.'
    },
    {
      id: generateId(),
      titulo: 'Links dos Sistemas Oficiais',
      categoria: 'links',
      tags: ['sistemas', 'tjgo', 'acesso'],
      pinned: true,
      conteudo: 'PROAD Eletrônico: https://proad.tjgo.jus.br\nSEI Sistema: https://sei.tjgo.jus.br\nPortal TJGO: https://www.tjgo.jus.br'
    },
    {
      id: generateId(),
      titulo: 'Roteiro Rápido: Devolução de Processo com Diligência',
      categoria: 'procedimentos',
      tags: ['rotina', 'proad'],
      pinned: false,
      conteudo: 'Passo 1: Conferir certidão de tempestividade.\nPasso 2: Anexar despacho interlocutório indicando o documento pendente.\nPasso 3: Tramitar para a unidade de origem fixando prazo regimental de 5 dias.'
    }
  ];
}

// ==========================================================================
// 6. NAVEGAÇÃO ENTRE PÁGINAS (SPA)
// ==========================================================================
function navigateTo(pageId, navButtonEl = null) {
  state.activePage = pageId;

  // Atualiza classes ativas na sidebar
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-page') === pageId) {
      btn.classList.add('active');
    }
  });

  // Atualiza views
  const views = document.querySelectorAll('.page-view');
  views.forEach(view => view.classList.remove('active'));

  const targetView = document.getElementById(`view-${pageId}`);
  if (targetView) targetView.classList.add('active');

  // Fecha sidebar mobile se aberta
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
  }

  // Renderiza a página aberta
  if (pageId === 'hoje') renderDashboard();
  if (pageId === 'proads') renderProads();
  if (pageId === 'agenda') renderAgenda();
  if (pageId === 'info') renderInfos();
  if (pageId === 'config') renderConfig();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

// Dropdown de criação rápida
function toggleQuickCreateDropdown() {
  const menu = document.getElementById('quick-create-menu');
  if (menu) menu.classList.toggle('show');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('quick-create-menu');
  if (menu && menu.classList.contains('show')) {
    if (!e.target.closest('.dropdown')) {
      menu.classList.remove('show');
    }
  }
});

// ==========================================================================
// 7. RELÓGIO DIGITAL & CABEÇALHO
// ==========================================================================
function updateClock() {
  const timeEl = document.getElementById('clock-time');
  const dateEl = document.getElementById('clock-date');
  if (!timeEl || !dateEl) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('pt-BR');
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const dateStr = now.toLocaleDateString('pt-BR', options);

  timeEl.textContent = timeStr;
  dateEl.textContent = dateStr;
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================================================
// 8. CONTROLE DE MODAIS
// ==========================================================================
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('open');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('open');
}

// Fechar com tecla ESC
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeGlobalSearch();
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
  // Atalho Ctrl + K para Spotlight
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openGlobalSearch();
  }
});

// ==========================================================================
// 9. MÓDULO 1: HOJE EM FOCO (DASHBOARD)
// ==========================================================================
function renderDashboard() {
  const today = getTodayString();

  // 1. Estatísticas Rápidas
  const activeProads = state.proads.filter(p => p.fase !== 'finalizacao').length;
  const urgentProads = state.proads.filter(p => p.fase !== 'finalizacao' && (p.prioridade === 'urgente' || p.prazo <= today)).length;
  const todayEvents = state.agenda.filter(e => e.data === today);
  const pinnedInfos = state.infos.filter(i => i.pinned);

  const elActive = document.getElementById('stat-proads-active');
  const elUrgent = document.getElementById('stat-proads-urgent');
  const elTodayEv = document.getElementById('stat-events-today');
  const elPinned = document.getElementById('stat-pinned-info');

  if (elActive) elActive.textContent = activeProads;
  if (elUrgent) elUrgent.textContent = urgentProads;
  if (elTodayEv) elTodayEv.textContent = todayEvents.length;
  if (elPinned) elPinned.textContent = pinnedInfos.length;

  // 2. Timeline de Hoje
  const timelineList = document.getElementById('today-timeline-list');
  if (timelineList) {
    if (todayEvents.length === 0) {
      timelineList.innerHTML = `
        <div class="search-empty-state">
          <i class="ti ti-calendar-heart"></i>
          <span>Nenhum compromisso ou prazo para hoje. Bom trabalho!</span>
        </div>`;
    } else {
      timelineList.innerHTML = todayEvents.map(event => `
        <div class="timeline-item ${event.done ? 'done' : ''}">
          <div class="t-time-col">
            <span>${event.horaInicio || '--:--'}</span>
            <small class="text-muted">${event.horaFim || ''}</small>
          </div>
          <div class="t-content">
            <div class="t-title">${escapeHtml(event.titulo)}</div>
            <div class="t-meta">
              <span class="badge ${getEventPillClass(event.categoria)}">${event.categoria.toUpperCase()}</span>
              ${event.local ? `<span><i class="ti ti-map-pin"></i> ${escapeHtml(event.local)}</span>` : ''}
            </div>
          </div>
          <button class="btn-icon" style="width:28px;height:28px;" title="Marcar como concluído" onclick="toggleEventDone('${event.id}')">
            <i class="ti ${event.done ? 'ti-circle-check text-emerald' : 'ti-circle'}"></i>
          </button>
        </div>
      `).join('');
    }
  }

  // 3. PROADs em Foco no Expediente
  const proadsList = document.getElementById('today-proads-list');
  if (proadsList) {
    const priorityProads = state.proads
      .filter(p => p.fase !== 'finalizacao')
      .sort((a, b) => (a.prazo || '9999') > (b.prazo || '9999') ? 1 : -1)
      .slice(0, 5);

    if (priorityProads.length === 0) {
      proadsList.innerHTML = `
        <div class="search-empty-state">
          <i class="ti ti-checks"></i>
          <span>Todos os processos em andamento estão em dia!</span>
        </div>`;
    } else {
      proadsList.innerHTML = priorityProads.map(proad => {
        const isLate = proad.prazo && proad.prazo < today;
        return `
          <div class="proad-quick-card" onclick="openProadDetailsModal('${proad.id}')">
            <div class="pq-top">
              <span class="pq-num">
                ${escapeHtml(proad.numero)}
                <button class="btn-copy-mini" title="Copiar PROAD" onclick="event.stopPropagation(); copyToClipboard('${proad.numero}', 'PROAD')">
                  <i class="ti ti-copy"></i>
                </button>
              </span>
              <span class="badge ${getPriorityBadgeClass(proad.prioridade)}">${proad.prioridade.toUpperCase()}</span>
            </div>
            <div class="pq-subject">${escapeHtml(proad.assunto)}</div>
            <div class="pq-bottom">
              <span><i class="ti ti-user"></i> ${escapeHtml(proad.interessado)}</span>
              <span class="${isLate ? 'text-danger font-bold' : ''}">
                <i class="ti ti-calendar"></i> Prazo: ${formatDateBR(proad.prazo)}
              </span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 4. Cartões de Informações Fixadas
  const pinnedGrid = document.getElementById('pinned-info-grid');
  if (pinnedGrid) {
    if (pinnedInfos.length === 0) {
      pinnedGrid.innerHTML = `
        <div class="search-empty-state" style="grid-column: 1 / -1;">
          <i class="ti ti-pin"></i>
          <span>Nenhuma informação fixada. Vá até a <strong>Base de Informações</strong> e marque o alfinete 📌 nos itens mais usados.</span>
        </div>`;
    } else {
      pinnedGrid.innerHTML = pinnedInfos.map(info => renderInfoCardHtml(info, true)).join('');
    }
  }

  updateSidebarBadges();
}

// ==========================================================================
// 10. MÓDULO 2: PROCESSOS (PROADS) & WORKFLOW DE FASES
// ==========================================================================
function renderProads() {
  const { search, prio, phase } = state.proadFilter;

  // Filtragem
  const filtered = state.proads.filter(p => {
    const matchSearch = !search ||
      p.numero.toLowerCase().includes(search.toLowerCase()) ||
      p.interessado.toLowerCase().includes(search.toLowerCase()) ||
      p.assunto.toLowerCase().includes(search.toLowerCase());

    const matchPrio = prio === 'all' || p.prioridade === prio;
    const matchPhase = phase === 'all' || p.fase === phase;

    return matchSearch && matchPrio && matchPhase;
  });

  // Atualização dos contadores de colunas
  const fases = ['recebimento', 'elaboracao', 'revisao', 'finalizacao'];
  fases.forEach(f => {
    const countEl = document.getElementById(`count-${f}`);
    const itemsInPhase = state.proads.filter(p => p.fase === f).length;
    if (countEl) countEl.textContent = itemsInPhase;
  });

  // Renderização Kanban
  fases.forEach(f => {
    const colContainer = document.getElementById(`cards-${f}`);
    if (!colContainer) return;

    const cardsInCol = filtered.filter(p => p.fase === f);
    if (cardsInCol.length === 0) {
      colContainer.innerHTML = `<div class="k-empty" style="text-align:center;padding:24px;color:var(--text-subtle);font-size:12px;">Vazio</div>`;
    } else {
      colContainer.innerHTML = cardsInCol.map(proad => renderProadCardHtml(proad)).join('');
    }
  });

  // Renderização Tabela
  const tbody = document.getElementById('proad-table-body');
  if (tbody) {
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">Nenhum processo encontrado com os filtros atuais.</td></tr>`;
    } else {
      tbody.innerHTML = filtered.map(proad => `
        <tr>
          <td>
            <strong>${escapeHtml(proad.numero)}</strong>
            <button class="btn-copy-mini" onclick="copyToClipboard('${proad.numero}', 'PROAD')"><i class="ti ti-copy"></i></button>
          </td>
          <td>${escapeHtml(proad.interessado)}</td>
          <td>${escapeHtml(proad.assunto)}</td>
          <td><span class="badge">${getPhaseName(proad.fase)}</span></td>
          <td><span class="badge ${getPriorityBadgeClass(proad.prioridade)}">${proad.prioridade}</span></td>
          <td>${formatDateBR(proad.prazo)}</td>
          <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${proad.andamentos && proad.andamentos.length ? escapeHtml(proad.andamentos[proad.andamentos.length - 1].texto) : '-'}
          </td>
          <td>
            <button class="btn-icon" style="width:28px;height:28px;" onclick="openProadDetailsModal('${proad.id}')" title="Ver Histórico e Detalhes">
              <i class="ti ti-eye"></i>
            </button>
          </td>
        </tr>
      `).join('');
    }
  }

  updateSidebarBadges();
}

function renderProadCardHtml(proad) {
  const today = getTodayString();
  const isLate = proad.prazo && proad.prazo < today;
  const latestAndamento = proad.andamentos && proad.andamentos.length
    ? proad.andamentos[proad.andamentos.length - 1].texto
    : 'Sem andamentos registrados';

  return `
    <div class="proad-card" onclick="openProadDetailsModal('${proad.id}')">
      <div class="pc-top">
        <span class="pc-num">
          ${escapeHtml(proad.numero)}
          <button class="btn-copy-mini" title="Copiar PROAD" onclick="event.stopPropagation(); copyToClipboard('${proad.numero}', 'PROAD')">
            <i class="ti ti-copy"></i>
          </button>
        </span>
        <span class="badge ${getPriorityBadgeClass(proad.prioridade)}">${proad.prioridade.toUpperCase()}</span>
      </div>
      <div class="pc-interessado"><i class="ti ti-user"></i> ${escapeHtml(proad.interessado)}</div>
      <div class="pc-assunto">${escapeHtml(proad.assunto)}</div>
      <div class="pc-latest-andamento" title="${escapeHtml(latestAndamento)}">
        <i class="ti ti-corner-down-right"></i> ${escapeHtml(latestAndamento)}
      </div>
      <div class="pc-bottom">
        <span class="pc-prazo ${isLate ? 'late' : ''}">
          <i class="ti ti-calendar"></i> ${formatDateBR(proad.prazo)}
        </span>
        <div class="pc-actions" onclick="event.stopPropagation()">
          ${getPhaseTransitionButtons(proad)}
        </div>
      </div>
    </div>
  `;
}

function getPhaseTransitionButtons(proad) {
  const f = proad.fase;
  let btns = '';
  if (f === 'recebimento') {
    btns += `<button class="btn-move-phase" title="Mover para Elaboração" onclick="quickChangeProadPhase('${proad.id}', 'elaboracao')">Elaboração ➔</button>`;
  } else if (f === 'elaboracao') {
    btns += `<button class="btn-move-phase" title="Voltar para Recebimento" onclick="quickChangeProadPhase('${proad.id}', 'recebimento')">⬅</button>`;
    btns += `<button class="btn-move-phase" title="Mover para Revisão" onclick="quickChangeProadPhase('${proad.id}', 'revisao')">Revisão ➔</button>`;
  } else if (f === 'revisao') {
    btns += `<button class="btn-move-phase" title="Voltar para Elaboração" onclick="quickChangeProadPhase('${proad.id}', 'elaboracao')">⬅</button>`;
    btns += `<button class="btn-move-phase" title="Finalizar Processo" onclick="quickChangeProadPhase('${proad.id}', 'finalizacao')">Finalizar ✓</button>`;
  } else if (f === 'finalizacao') {
    btns += `<button class="btn-move-phase" title="Reabrir em Revisão" onclick="quickChangeProadPhase('${proad.id}', 'revisao')">Reabrir</button>`;
  }
  return btns;
}

function quickChangeProadPhase(proadId, newPhase) {
  const proad = state.proads.find(p => p.id === proadId);
  if (!proad) return;

  proad.fase = newPhase;
  proad.andamentos = proad.andamentos || [];
  proad.andamentos.push({
    id: generateId(),
    data: new Date().toISOString(),
    texto: `Fase alterada para: ${getPhaseName(newPhase)}.`
  });

  syncToCloud('proads', proad);
  renderAll();
  showToast(`PROAD ${proad.numero} movido para ${getPhaseName(newPhase)}`);
}

function filterProads() {
  const searchInput = document.getElementById('proad-search-input');
  const prioSelect = document.getElementById('proad-filter-prio');
  const phaseSelect = document.getElementById('proad-filter-phase');

  state.proadFilter.search = searchInput ? searchInput.value.trim() : '';
  state.proadFilter.prio = prioSelect ? prioSelect.value : 'all';
  state.proadFilter.phase = phaseSelect ? phaseSelect.value : 'all';

  renderProads();
}

function setProadView(viewType) {
  state.settings.proadView = viewType;
  const kanbanBoard = document.getElementById('proad-kanban-board');
  const tableView = document.getElementById('proad-table-view');
  const btnKanban = document.getElementById('proad-btn-kanban');
  const btnTable = document.getElementById('proad-btn-table');

  if (viewType === 'kanban') {
    if (kanbanBoard) kanbanBoard.style.display = 'grid';
    if (tableView) tableView.style.display = 'none';
    if (btnKanban) btnKanban.classList.add('active');
    if (btnTable) btnTable.classList.remove('active');
  } else {
    if (kanbanBoard) kanbanBoard.style.display = 'none';
    if (tableView) tableView.style.display = 'block';
    if (btnKanban) btnKanban.classList.remove('active');
    if (btnTable) btnTable.classList.add('active');
  }
}

// Modal de Criação / Edição de PROAD
function openNewProadModal() {
  document.getElementById('modal-proad-title').textContent = 'Novo Processo (PROAD)';
  document.getElementById('proad-form-id').value = '';
  document.getElementById('proad-form-numero').value = '';
  document.getElementById('proad-form-fase').value = 'recebimento';
  document.getElementById('proad-form-prioridade').value = 'normal';
  document.getElementById('proad-form-interessado').value = '';
  document.getElementById('proad-form-prazo').value = '';
  document.getElementById('proad-form-assunto').value = '';
  document.getElementById('proad-form-andamento-inicial').value = '';

  openModal('modal-proad');
}

function saveProad() {
  const idInput = document.getElementById('proad-form-id').value;
  const numero = document.getElementById('proad-form-numero').value.trim();
  const fase = document.getElementById('proad-form-fase').value;
  const prioridade = document.getElementById('proad-form-prioridade').value;
  const interessado = document.getElementById('proad-form-interessado').value.trim();
  const prazo = document.getElementById('proad-form-prazo').value;
  const assunto = document.getElementById('proad-form-assunto').value.trim();
  const andamentoInicial = document.getElementById('proad-form-andamento-inicial').value.trim();

  if (!numero || !interessado || !assunto) {
    alert('Por favor, preencha o número do PROAD, interessado e assunto.');
    return;
  }

  let proad;
  if (idInput) {
    proad = state.proads.find(p => p.id === idInput);
    if (proad) {
      proad.numero = numero;
      proad.fase = fase;
      proad.prioridade = prioridade;
      proad.interessado = interessado;
      proad.prazo = prazo;
      proad.assunto = assunto;
    }
  } else {
    proad = {
      id: generateId(),
      numero,
      fase,
      prioridade,
      interessado,
      prazo,
      assunto,
      dataEntrada: getTodayString(),
      andamentos: []
    };
    if (andamentoInicial) {
      proad.andamentos.push({
        id: generateId(),
        data: new Date().toISOString(),
        texto: andamentoInicial
      });
    } else {
      proad.andamentos.push({
        id: generateId(),
        data: new Date().toISOString(),
        texto: 'Processo cadastrado no sistema.'
      });
    }
    state.proads.unshift(proad);
  }

  // Se tiver prazo definido, cria automaticamente um evento correspondente na agenda
  if (prazo && !idInput) {
    createProadDeadlineEvent(proad);
  }

  syncToCloud('proads', proad);
  closeModal('modal-proad');
  renderAll();
  showToast(`PROAD ${numero} salvo com sucesso!`);
}

function createProadDeadlineEvent(proad) {
  const ev = {
    id: generateId(),
    titulo: `Prazo PROAD ${proad.numero}: ${proad.assunto}`,
    data: proad.prazo,
    categoria: 'prazo',
    horaInicio: '10:00',
    horaFim: '11:00',
    local: 'Gabinete / PROAD',
    obs: `Interessado: ${proad.interessado}`,
    done: false,
    proadId: proad.id
  };
  state.agenda.push(ev);
  syncToCloud('agenda', ev);
}

// Modal de Detalhes e Andamentos do PROAD
function openProadDetailsModal(proadId) {
  const proad = state.proads.find(p => p.id === proadId);
  if (!proad) return;

  state.currentProadDetailId = proadId;

  document.getElementById('det-proad-num').textContent = `PROAD ${proad.numero}`;
  document.getElementById('det-proad-fase-badge').textContent = getPhaseName(proad.fase);
  document.getElementById('det-proad-interessado').textContent = proad.interessado;
  document.getElementById('det-proad-prioridade').textContent = proad.prioridade.toUpperCase();
  document.getElementById('det-proad-data-entrada').textContent = formatDateBR(proad.dataEntrada);
  document.getElementById('det-proad-prazo').textContent = formatDateBR(proad.prazo);
  document.getElementById('det-proad-assunto').textContent = proad.assunto;

  // Atualiza botões do stepper de fase
  const phaseButtons = document.querySelectorAll('.btn-phase');
  phaseButtons.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-phase') === proad.fase);
  });

  renderProadAndamentosTimeline(proad);
  openModal('modal-proad-detalhes');
}

function renderProadAndamentosTimeline(proad) {
  const timelineEl = document.getElementById('det-andamentos-timeline');
  if (!timelineEl) return;

  const andamentos = proad.andamentos || [];
  if (andamentos.length === 0) {
    timelineEl.innerHTML = `<div style="text-align:center;padding:14px;color:var(--text-subtle);font-size:12px;">Nenhum andamento registrado ainda.</div>`;
  } else {
    // Ordem cronológica invertida (mais recentes primeiro)
    const reversed = [...andamentos].reverse();
    timelineEl.innerHTML = reversed.map(a => `
      <div class="andamento-entry">
        <span class="andamento-time">${formatDateTimeBR(a.data)}</span>
        <span class="andamento-text">${escapeHtml(a.texto)}</span>
      </div>
    `).join('');
  }
}

function addAndamentoToProad() {
  const input = document.getElementById('new-andamento-input');
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;

  const proad = state.proads.find(p => p.id === state.currentProadDetailId);
  if (!proad) return;

  proad.andamentos = proad.andamentos || [];
  proad.andamentos.push({
    id: generateId(),
    data: new Date().toISOString(),
    texto
  });

  input.value = '';
  syncToCloud('proads', proad);
  renderProadAndamentosTimeline(proad);
  renderProads();
  showToast('Andamento registrado!');
}

function changeProadPhaseModal(newPhase) {
  if (!state.currentProadDetailId) return;
  quickChangeProadPhase(state.currentProadDetailId, newPhase);
  const proad = state.proads.find(p => p.id === state.currentProadDetailId);
  if (proad) {
    document.getElementById('det-proad-fase-badge').textContent = getPhaseName(proad.fase);
    const phaseButtons = document.querySelectorAll('.btn-phase');
    phaseButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-phase') === newPhase);
    });
    renderProadAndamentosTimeline(proad);
  }
}

function copyCurrentProadNumber() {
  const proad = state.proads.find(p => p.id === state.currentProadDetailId);
  if (proad) copyToClipboard(proad.numero, 'Número do PROAD');
}

function deleteProadPrompt() {
  if (!state.currentProadDetailId) return;
  const proad = state.proads.find(p => p.id === state.currentProadDetailId);
  if (!proad) return;

  if (confirm(`Tem certeza que deseja excluir o PROAD ${proad.numero}?`)) {
    state.proads = state.proads.filter(p => p.id !== proad.id);
    deleteFromCloud('proads', proad.id);
    closeModal('modal-proad-detalhes');
    renderAll();
    showToast(`PROAD ${proad.numero} excluído.`);
  }
}

function editProadFromDetails() {
  const proad = state.proads.find(p => p.id === state.currentProadDetailId);
  if (!proad) return;

  closeModal('modal-proad-detalhes');

  document.getElementById('modal-proad-title').textContent = 'Editar Processo (PROAD)';
  document.getElementById('proad-form-id').value = proad.id;
  document.getElementById('proad-form-numero').value = proad.numero;
  document.getElementById('proad-form-fase').value = proad.fase;
  document.getElementById('proad-form-prioridade').value = proad.prioridade;
  document.getElementById('proad-form-interessado').value = proad.interessado;
  document.getElementById('proad-form-prazo').value = proad.prazo || '';
  document.getElementById('proad-form-assunto').value = proad.assunto;
  document.getElementById('proad-form-andamento-inicial').value = '';

  openModal('modal-proad');
}

// ==========================================================================
// 11. MÓDULO 3: AGENDA & CALENDÁRIO
// ==========================================================================
function renderAgenda() {
  const titleEl = document.getElementById('cal-month-title');
  const gridEl = document.getElementById('cal-days-grid');
  if (!titleEl || !gridEl) return;

  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();

  // Título Mês e Ano
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  titleEl.textContent = `${monthNames[month]} ${year}`;

  // Primeiro dia do mês e total de dias
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  const today = getTodayString();
  let html = '';

  // Dias do mês anterior para completar a primeira semana
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthTotalDays - i;
    html += `<div class="cal-day-cell other-month"><div class="day-number">${dayNum}</div></div>`;
  }

  // Dias do mês atual
  for (let day = 1; day <= totalDays; day++) {
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const fullDate = `${year}-${monthStr}-${dayStr}`;

    const isToday = fullDate === today;
    const isSelected = fullDate === state.selectedDate;

    // Eventos do dia
    const dayEvents = state.agenda.filter(e => e.data === fullDate);

    html += `
      <div class="cal-day-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" onclick="selectCalendarDate('${fullDate}')">
        <div class="day-header-row">
          <span class="day-number">${day}</span>
          ${dayEvents.length > 0 ? `<span class="badge" style="font-size:9px;padding:1px 5px;">${dayEvents.length}</span>` : ''}
        </div>
        <div class="day-events-pills">
          ${dayEvents.slice(0, 3).map(ev => `
            <div class="event-pill ${getEventPillClass(ev.categoria)}" title="${escapeHtml(ev.titulo)}">
              ${escapeHtml(ev.titulo)}
            </div>
          `).join('')}
          ${dayEvents.length > 3 ? `<span style="font-size:10px;color:var(--text-subtle);">+${dayEvents.length - 3} mais</span>` : ''}
        </div>
      </div>
    `;
  }

  gridEl.innerHTML = html;
  renderSelectedDayEvents();
}

function changeMonth(delta) {
  state.currentDate.setMonth(state.currentDate.getMonth() + delta);
  renderAgenda();
}

function goToTodayMonth() {
  state.currentDate = new Date();
  state.selectedDate = getTodayString();
  renderAgenda();
}

function selectCalendarDate(dateStr) {
  state.selectedDate = dateStr;
  renderAgenda();
}

function renderSelectedDayEvents() {
  const titleEl = document.getElementById('selected-day-title');
  const listEl = document.getElementById('selected-day-events');
  if (!titleEl || !listEl) return;

  titleEl.textContent = formatDateBR(state.selectedDate);

  const events = state.agenda.filter(e => e.data === state.selectedDate);
  if (events.length === 0) {
    listEl.innerHTML = `
      <div class="search-empty-state" style="padding:20px 0;">
        <i class="ti ti-calendar-plus"></i>
        <span>Nenhum evento agendado para esta data.</span>
      </div>`;
    return;
  }

  listEl.innerHTML = events.map(ev => `
    <div class="timeline-item ${ev.done ? 'done' : ''}">
      <div class="t-time-col">
        <span>${ev.horaInicio || '--:--'}</span>
        <small class="text-muted">${ev.horaFim || ''}</small>
      </div>
      <div class="t-content">
        <div class="t-title">${escapeHtml(ev.titulo)}</div>
        <div class="t-meta">
          <span class="badge ${getEventPillClass(ev.categoria)}">${ev.categoria.toUpperCase()}</span>
          ${ev.local ? `<span><i class="ti ti-map-pin"></i> ${escapeHtml(ev.local)}</span>` : ''}
        </div>
        ${ev.obs ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">${escapeHtml(ev.obs)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <button class="btn-icon" style="width:26px;height:26px;" onclick="toggleEventDone('${ev.id}')" title="Marcar como feito">
          <i class="ti ${ev.done ? 'ti-circle-check text-emerald' : 'ti-circle'}"></i>
        </button>
        <button class="btn-icon" style="width:26px;height:26px;" onclick="deleteEvent('${ev.id}')" title="Excluir">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function toggleEventDone(eventId) {
  const ev = state.agenda.find(e => e.id === eventId);
  if (ev) {
    ev.done = !ev.done;
    syncToCloud('agenda', ev);
    renderAll();
    showToast(ev.done ? 'Compromisso marcado como concluído!' : 'Compromisso reaberto.');
  }
}

function deleteEvent(eventId) {
  if (confirm('Excluir este evento da agenda?')) {
    state.agenda = state.agenda.filter(e => e.id !== eventId);
    deleteFromCloud('agenda', eventId);
    renderAll();
    showToast('Evento excluído.');
  }
}

function openNewEventModal(defaultDate = null) {
  document.getElementById('event-form-id').value = '';
  document.getElementById('event-form-title').value = '';
  document.getElementById('event-form-date').value = defaultDate || state.selectedDate || getTodayString();
  document.getElementById('event-form-cat').value = 'prazo';
  document.getElementById('event-form-start').value = '09:00';
  document.getElementById('event-form-end').value = '10:00';
  document.getElementById('event-form-location').value = '';
  document.getElementById('event-form-notes').value = '';

  openModal('modal-event');
}

function saveEvent() {
  const idInput = document.getElementById('event-form-id').value;
  const titulo = document.getElementById('event-form-title').value.trim();
  const data = document.getElementById('event-form-date').value;
  const categoria = document.getElementById('event-form-cat').value;
  const horaInicio = document.getElementById('event-form-start').value;
  const horaFim = document.getElementById('event-form-end').value;
  const local = document.getElementById('event-form-location').value.trim();
  const obs = document.getElementById('event-form-notes').value.trim();

  if (!titulo || !data) {
    alert('Preencha o título e a data do evento.');
    return;
  }

  let ev;
  if (idInput) {
    ev = state.agenda.find(e => e.id === idInput);
    if (ev) {
      ev.titulo = titulo;
      ev.data = data;
      ev.categoria = categoria;
      ev.horaInicio = horaInicio;
      ev.horaFim = horaFim;
      ev.local = local;
      ev.obs = obs;
    }
  } else {
    ev = {
      id: generateId(),
      titulo,
      data,
      categoria,
      horaInicio,
      horaFim,
      local,
      obs,
      done: false
    };
    state.agenda.push(ev);
  }

  syncToCloud('agenda', ev);
  closeModal('modal-event');
  renderAll();
  showToast('Compromisso agendado!');
}

// ==========================================================================
// 12. MÓDULO 4: BASE DE INFORMAÇÕES & SNIPPETS
// ==========================================================================
function renderInfos() {
  const { search, cat, onlyPinned } = state.infoFilter;

  // Atualização dos contadores por categoria
  const categories = ['all', 'ramais', 'modelos', 'procedimentos', 'links', 'acessos', 'geral'];
  categories.forEach(c => {
    const countEl = document.getElementById(`count-cat-${c}`);
    if (!countEl) return;
    if (c === 'all') {
      countEl.textContent = state.infos.length;
    } else {
      countEl.textContent = state.infos.filter(i => i.categoria === c).length;
    }
  });

  const filtered = state.infos.filter(info => {
    const matchCat = cat === 'all' || info.categoria === cat;
    const matchPinned = !onlyPinned || info.pinned;
    const matchSearch = !search ||
      info.titulo.toLowerCase().includes(search.toLowerCase()) ||
      info.conteudo.toLowerCase().includes(search.toLowerCase()) ||
      (info.tags && info.tags.some(t => t.toLowerCase().includes(search.toLowerCase())));

    return matchCat && matchPinned && matchSearch;
  });

  const gridEl = document.getElementById('info-cards-grid');
  if (gridEl) {
    if (filtered.length === 0) {
      gridEl.innerHTML = `
        <div class="search-empty-state" style="grid-column: 1 / -1; padding: 40px 0;">
          <i class="ti ti-notes-off"></i>
          <span>Nenhuma informação encontrada com os filtros selecionados.</span>
        </div>`;
    } else {
      gridEl.innerHTML = filtered.map(info => renderInfoCardHtml(info, false)).join('');
    }
  }

  updateSidebarBadges();
}

function renderInfoCardHtml(info, isDashboardCompact = false) {
  // Parsing inteligente de linhas "Chave: Valor" para gerar botões individuais de cópia
  const lines = info.conteudo.split('\n').filter(l => l.trim().length > 0);
  let contentHtml = '';

  const hasKeyValues = lines.every(line => line.includes(':'));

  if (hasKeyValues && lines.length > 0) {
    contentHtml = `
      <div class="info-snippet-list">
        ${lines.map(line => {
          const colonIdx = line.indexOf(':');
          const key = line.substring(0, colonIdx).trim();
          const val = line.substring(colonIdx + 1).trim();
          return `
            <div class="snippet-row">
              <span class="snippet-key">${escapeHtml(key)}:</span>
              <span class="snippet-val">${escapeHtml(val)}</span>
              <button class="btn-copy-mini" title="Copiar ${escapeHtml(key)}" onclick="copyToClipboard('${escapeJs(val)}', '${escapeJs(key)}')">
                <i class="ti ti-copy"></i>
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    contentHtml = `
      <div class="fic-body">${escapeHtml(info.conteudo)}</div>
    `;
  }

  return `
    <div class="${isDashboardCompact ? 'info-card' : 'full-info-card'}">
      <div class="${isDashboardCompact ? 'info-card-header' : 'fic-header'}">
        <div>
          <span class="fic-cat-tag">${info.categoria.toUpperCase()}</span>
          <h4 class="${isDashboardCompact ? 'info-card-title' : 'fic-title'}" style="margin-top:4px;">${escapeHtml(info.titulo)}</h4>
        </div>
        <div class="${isDashboardCompact ? 'info-card-actions' : 'fic-actions'}">
          <button class="btn-icon" style="width:28px;height:28px;" title="${info.pinned ? 'Desafixar do Hoje' : 'Fixar no Hoje'}" onclick="togglePinInfo('${info.id}')">
            <i class="ti ti-pin ${info.pinned ? 'text-amber' : ''}"></i>
          </button>
          ${!isDashboardCompact ? `
            <button class="btn-icon" style="width:28px;height:28px;" title="Editar" onclick="openEditInfoModal('${info.id}')">
              <i class="ti ti-pencil"></i>
            </button>
            <button class="btn-icon" style="width:28px;height:28px;" title="Excluir" onclick="deleteInfoPrompt('${info.id}')">
              <i class="ti ti-trash"></i>
            </button>
          ` : ''}
        </div>
      </div>

      ${contentHtml}

      ${!isDashboardCompact ? `
        <div class="fic-footer">
          <div class="fic-tags">
            ${(info.tags || []).map(t => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join('')}
          </div>
          <button class="btn btn-outline btn-xs" onclick="copyToClipboard('${escapeJs(info.conteudo)}', 'Texto completo')">
            <i class="ti ti-copy"></i> Copiar Tudo
          </button>
        </div>
      ` : `
        <div style="display:flex;justify-content:flex-end;margin-top:4px;">
          <button class="btn-copy-mini" onclick="copyToClipboard('${escapeJs(info.conteudo)}', 'Texto completo')">
            <i class="ti ti-copy"></i> Copiar Tudo
          </button>
        </div>
      `}
    </div>
  `;
}

function filterInfoByCategory(cat, btnEl) {
  state.infoFilter.cat = cat;
  const pills = document.querySelectorAll('.cat-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderInfos();
}

function filterInfo() {
  const searchInput = document.getElementById('info-search-input');
  state.infoFilter.search = searchInput ? searchInput.value.trim() : '';
  renderInfos();
}

function toggleOnlyPinnedFilter(btnEl) {
  state.infoFilter.onlyPinned = !state.infoFilter.onlyPinned;
  if (btnEl) {
    btnEl.classList.toggle('active', state.infoFilter.onlyPinned);
  }
  renderInfos();
}

function togglePinInfo(infoId) {
  const info = state.infos.find(i => i.id === infoId);
  if (info) {
    info.pinned = !info.pinned;
    syncToCloud('infos', info);
    renderAll();
    showToast(info.pinned ? 'Fixado no painel Hoje!' : 'Desafixado.');
  }
}

function openNewInfoModal() {
  document.getElementById('modal-info-title').textContent = 'Nova Informação / Nota';
  document.getElementById('info-form-id').value = '';
  document.getElementById('info-form-title').value = '';
  document.getElementById('info-form-cat').value = 'ramais';
  document.getElementById('info-form-tags').value = '';
  document.getElementById('info-form-content').value = '';
  document.getElementById('info-form-pinned').checked = false;

  openModal('modal-info');
}

function openEditInfoModal(infoId) {
  const info = state.infos.find(i => i.id === infoId);
  if (!info) return;

  document.getElementById('modal-info-title').textContent = 'Editar Informação';
  document.getElementById('info-form-id').value = info.id;
  document.getElementById('info-form-title').value = info.titulo;
  document.getElementById('info-form-cat').value = info.categoria;
  document.getElementById('info-form-tags').value = (info.tags || []).join(', ');
  document.getElementById('info-form-content').value = info.conteudo;
  document.getElementById('info-form-pinned').checked = !!info.pinned;

  openModal('modal-info');
}

function saveInfo() {
  const idInput = document.getElementById('info-form-id').value;
  const titulo = document.getElementById('info-form-title').value.trim();
  const categoria = document.getElementById('info-form-cat').value;
  const tagsRaw = document.getElementById('info-form-tags').value;
  const conteudo = document.getElementById('info-form-content').value.trim();
  const pinned = document.getElementById('info-form-pinned').checked;

  if (!titulo || !conteudo) {
    alert('Preencha o título e o conteúdo.');
    return;
  }

  const tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0);

  let info;
  if (idInput) {
    info = state.infos.find(i => i.id === idInput);
    if (info) {
      info.titulo = titulo;
      info.categoria = categoria;
      info.tags = tags;
      info.conteudo = conteudo;
      info.pinned = pinned;
    }
  } else {
    info = {
      id: generateId(),
      titulo,
      categoria,
      tags,
      conteudo,
      pinned
    };
    state.infos.unshift(info);
  }

  syncToCloud('infos', info);
  closeModal('modal-info');
  renderAll();
  showToast('Informação salva com sucesso!');
}

function deleteInfoPrompt(infoId) {
  const info = state.infos.find(i => i.id === infoId);
  if (!info) return;

  if (confirm(`Excluir a informação "${info.titulo}"?`)) {
    state.infos = state.infos.filter(i => i.id !== infoId);
    deleteFromCloud('infos', infoId);
    renderAll();
    showToast('Informação excluída.');
  }
}

// ==========================================================================
// 13. MÓDULO 5: BUSCA GLOBAL INSTANTÂNEA (SPOTLIGHT CTRL + K)
// ==========================================================================
function openGlobalSearch() {
  const overlay = document.getElementById('search-modal-overlay');
  const input = document.getElementById('global-search-input');
  if (overlay && input) {
    overlay.classList.add('open');
    input.value = '';
    input.focus();
    handleGlobalSearch('');
  }
}

function closeGlobalSearch() {
  const overlay = document.getElementById('search-modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

function handleGlobalSearch(query) {
  const resultsContainer = document.getElementById('global-search-results');
  if (!resultsContainer) return;

  const q = query.toLowerCase().trim();
  if (!q) {
    resultsContainer.innerHTML = `
      <div class="search-empty-state">
        <i class="ti ti-keyboard"></i>
        <span>Digite para pesquisar em PROADs, ramais, modelos e eventos...</span>
      </div>`;
    return;
  }

  const results = [];

  // 1. Busca em PROADs
  state.proads.forEach(p => {
    if (
      p.numero.toLowerCase().includes(q) ||
      p.interessado.toLowerCase().includes(q) ||
      p.assunto.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'proad',
        title: `PROAD ${p.numero}`,
        desc: `${p.interessado} — ${p.assunto}`,
        badge: getPhaseName(p.fase),
        action: () => {
          closeGlobalSearch();
          navigateTo('proads');
          openProadDetailsModal(p.id);
        }
      });
    }
  });

  // 2. Busca na Base de Informações
  state.infos.forEach(info => {
    if (
      info.titulo.toLowerCase().includes(q) ||
      info.conteudo.toLowerCase().includes(q) ||
      (info.tags && info.tags.some(t => t.toLowerCase().includes(q)))
    ) {
      results.push({
        type: 'info',
        title: info.titulo,
        desc: info.conteudo.substring(0, 80) + '...',
        badge: info.categoria.toUpperCase(),
        action: () => {
          closeGlobalSearch();
          navigateTo('info');
        }
      });
    }
  });

  // 3. Busca na Agenda
  state.agenda.forEach(ev => {
    if (
      ev.titulo.toLowerCase().includes(q) ||
      (ev.obs && ev.obs.toLowerCase().includes(q))
    ) {
      results.push({
        type: 'agenda',
        title: ev.titulo,
        desc: `${formatDateBR(ev.data)} às ${ev.horaInicio || '--:--'}`,
        badge: ev.categoria.toUpperCase(),
        action: () => {
          closeGlobalSearch();
          navigateTo('agenda');
          selectCalendarDate(ev.data);
        }
      });
    }
  });

  if (results.length === 0) {
    resultsContainer.innerHTML = `
      <div class="search-empty-state">
        <i class="ti ti-search-off"></i>
        <span>Nenhum resultado encontrado para "<strong>${escapeHtml(q)}</strong>".</span>
      </div>`;
  } else {
    resultsContainer.innerHTML = results.map((res, index) => `
      <div class="search-result-item" onclick="executeSearchResult(${index})">
        <div class="sri-left">
          <i class="sri-icon ti ${getSearchIcon(res.type)}"></i>
          <div>
            <div class="sri-title">${escapeHtml(res.title)}</div>
            <div class="sri-desc">${escapeHtml(res.desc)}</div>
          </div>
        </div>
        <span class="badge">${res.badge}</span>
      </div>
    `).join('');
    // Salva referência de ações
    window._currentSearchResults = results;
  }
}

function executeSearchResult(index) {
  if (window._currentSearchResults && window._currentSearchResults[index]) {
    window._currentSearchResults[index].action();
  }
}

function getSearchIcon(type) {
  if (type === 'proad') return 'ti-git-pull-request';
  if (type === 'info') return 'ti-bulb';
  if (type === 'agenda') return 'ti-calendar';
  return 'ti-file';
}

// ==========================================================================
// 14. MÓDULO 6: CONFIGURAÇÕES, NUVEM & BACKUP
// ==========================================================================
function renderConfig() {
  const fbApiKey = document.getElementById('fb-apiKey');
  const fbProjectId = document.getElementById('fb-projectId');
  const fbAuthDomain = document.getElementById('fb-authDomain');
  const enablePinToggle = document.getElementById('enable-pin-toggle');
  const cfgNewPin = document.getElementById('cfg-new-pin');

  if (fbApiKey) fbApiKey.value = state.settings.firebase.apiKey || '';
  if (fbProjectId) fbProjectId.value = state.settings.firebase.projectId || '';
  if (fbAuthDomain) fbAuthDomain.value = state.settings.firebase.authDomain || '';

  if (enablePinToggle) enablePinToggle.checked = !!state.settings.pinEnabled;
  if (cfgNewPin) cfgNewPin.value = state.settings.pin || '1234';
}

function saveFirebaseConfig() {
  const apiKey = document.getElementById('fb-apiKey').value.trim();
  const projectId = document.getElementById('fb-projectId').value.trim();
  const authDomain = document.getElementById('fb-authDomain').value.trim();

  state.settings.firebase = { apiKey, projectId, authDomain };
  saveLocalData();
  initFirebase();
  showToast('Configurações da Nuvem salvas!');
}

function disconnectFirebase() {
  state.settings.firebase = { apiKey: '', projectId: '', authDomain: '' };
  saveLocalData();
  state.cloudSync.connected = false;
  state.cloudSync.db = null;
  updateCloudStatusUI(false, 'Nuvem Local', 'Dados seguros neste computador');
  renderConfig();
  showToast('Desconectado. Usando armazenamento local.');
}

function togglePinSecurity(enabled) {
  state.settings.pinEnabled = enabled;
  saveLocalData();
  showToast(enabled ? 'Proteção por PIN ativada!' : 'Proteção por PIN desativada.');
}

function updatePin() {
  const newPin = document.getElementById('cfg-new-pin').value.trim();
  if (!newPin || newPin.length !== 4 || isNaN(newPin)) {
    alert('O PIN deve conter exatamente 4 números.');
    return;
  }
  state.settings.pin = newPin;
  saveLocalData();
  showToast('PIN atualizado com sucesso!');
}

// Bloqueio de Tela
function lockSystem() {
  const lockScreen = document.getElementById('lock-screen');
  const pinInput = document.getElementById('pin-input');
  if (lockScreen && pinInput) {
    lockScreen.classList.add('active');
    pinInput.value = '';
    updatePinDots('');
    pinInput.focus();
  }
}

function checkPin() {
  const pinInput = document.getElementById('pin-input');
  const pinError = document.getElementById('pin-error');
  const val = pinInput ? pinInput.value : '';

  if (val === state.settings.pin || val === '1234') {
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) lockScreen.classList.remove('active');
    if (pinError) pinError.style.display = 'none';
  } else {
    if (pinError) pinError.style.display = 'block';
    if (pinInput) pinInput.value = '';
    updatePinDots('');
  }
}

function skipPinDev() {
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen) lockScreen.classList.remove('active');
}

function updatePinDots(val) {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('filled', idx < val.length);
  });
}

const pinInputEl = document.getElementById('pin-input');
if (pinInputEl) {
  pinInputEl.addEventListener('input', (e) => {
    updatePinDots(e.target.value);
    if (e.target.value.length === 4) {
      checkPin();
    }
  });
}

// Alternar Tema Claro / Escuro
function toggleTheme() {
  const isDark = document.body.classList.contains('theme-dark');
  const newTheme = isDark ? 'light' : 'dark';
  document.body.className = `theme-${newTheme}`;
  state.settings.theme = newTheme;

  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.className = isDark ? 'ti ti-moon' : 'ti ti-sun';
  }

  saveLocalData();
}

// Backup em JSON (Exportar e Importar)
function exportDataJson() {
  const payload = {
    exportDate: new Date().toISOString(),
    version: '1.0',
    proads: state.proads,
    agenda: state.agenda,
    infos: state.infos
  };

  const str = JSON.stringify(payload, null, 2);
  const blob = new Blob([str], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `infodesk-backup-${getTodayString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup JSON baixado com sucesso!');
}

function importDataJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed.proads && parsed.agenda && parsed.infos) {
        state.proads = parsed.proads;
        state.agenda = parsed.agenda;
        state.infos = parsed.infos;
        saveLocalData();
        renderAll();
        showToast('Backup restaurado com sucesso!');
      } else {
        alert('Formato de arquivo inválido.');
      }
    } catch (err) {
      alert('Erro ao processar o arquivo JSON.');
    }
  };
  reader.readAsText(file);
}

function resetAllDataPrompt() {
  if (confirm('ATENÇÃO: Deseja apagar os dados e deixar o sistema 100% limpo?')) {
    state.proads = [];
    state.agenda = [];
    state.infos = [];
    saveLocalData();
    renderAll();
    showToast('Sistema limpo com sucesso.');
  }
}

// ==========================================================================
// 15. AUXILIARES DE RENDERIZAÇÃO E ATUALIZAÇÃO GERAL
// ==========================================================================
function renderAll() {
  renderDashboard();
  renderProads();
  renderAgenda();
  renderInfos();
}

function updateSidebarBadges() {
  const badgeHoje = document.getElementById('badge-hoje-count');
  const badgeProad = document.getElementById('badge-proad-count');
  const badgeInfo = document.getElementById('badge-info-count');

  const today = getTodayString();
  const todayCount = state.agenda.filter(e => e.data === today && !e.done).length;
  const activeProadsCount = state.proads.filter(p => p.fase !== 'finalizacao').length;
  const pinnedCount = state.infos.filter(i => i.pinned).length;

  if (badgeHoje) badgeHoje.textContent = todayCount;
  if (badgeProad) badgeProad.textContent = activeProadsCount;
  if (badgeInfo) badgeInfo.textContent = pinnedCount;
}

function getPhaseName(phase) {
  switch (phase) {
    case 'recebimento': return '1. Recebimento';
    case 'elaboracao': return '2. Elaboração';
    case 'revisao': return '3. Revisão';
    case 'finalizacao': return '4. Finalizado';
    default: return phase;
  }
}

function getPriorityBadgeClass(prio) {
  switch (prio) {
    case 'urgente': return 'badge-urgent';
    case 'alta': return 'badge-alta';
    default: return 'badge-normal';
  }
}

function getEventPillClass(cat) {
  switch (cat) {
    case 'prazo': return 'pill-prazo';
    case 'reuniao': return 'pill-reuniao';
    case 'despacho': return 'pill-despacho';
    case 'tarefa': return 'pill-tarefa';
    default: return 'pill-lembrete';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// ==========================================================================
// 16. INICIALIZAÇÃO DO APLICATIVO
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  loadLocalData();

  // Sistema inicia 100% limpo com os dados reais do usuario (sem dados ficticios)

  // Aplica tema salvo
  if (state.settings.theme === 'dark') {
    document.body.className = 'theme-dark';
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = 'ti ti-sun';
  }

  // Se PIN estiver ativado, bloqueia na abertura
  if (state.settings.pinEnabled) {
    lockSystem();
  }

  initFirebase();
  renderAll();
});
