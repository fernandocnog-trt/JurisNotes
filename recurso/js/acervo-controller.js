/* ================================================
   acervo-controller.js
   CONTROLE DE INTERFACE PARA MODELOS E TAGS (ACERVO)
   ================================================ */

// Variáveis de Estado Isolado para o Acervo
let _idsRecomendadosIA = null;
let _noAlvoParaSalvar = null;

window.aplicarFiltroIAAcervo = function(idsArray) {
    _idsRecomendadosIA = idsArray;
    window.abrirModalAcervo();
};

window.limparFiltroIAAcervo = function() {
    _idsRecomendadosIA = null;
    window.abrirModalAcervo(); 
};
// ==========================================
// ESTADO DO ACERVO (Isolado e Seguro)
// ==========================================
let _modeloSelecionadoId = null;
let _modeloSelecionadoNodes = [];
let _tagsGlobais = [];
let _tagsModeloEmEdicao = [];
let _modeloSelecionadoEscopo = 'card';

let _todosModelosEmMemoria = [];
let _modelosFiltrados = [];
let _paginaAtualRenderizacao = 0;
const TAMANHO_LOTE_RENDERIZACAO = 20;
let _observerScrollAcervo = null;
let _eventDelegationAtivo = false;

// ==========================================
// TRAVA DE ESTADO ARQUITETURAL (State Lock)
// ==========================================
let _isViewTransitioning = false;

// HELPER PRIVADO: Manipulação segura de DOM
function _safeDisplay(id, styleStr) {
    const el = document.getElementById(id);
    if (el) el.style.display = styleStr;
}

function _isModeloAuditado(mod) {
    if (window.AcervoManager && typeof AcervoManager.verificarSeModeloAuditado === 'function') {
        return AcervoManager.verificarSeModeloAuditado(mod);
    }
    if (!mod || !mod.auditoriaIA) return false;
    const qtdNos = Array.isArray(mod.nos) ? mod.nos.length : 0;
    return mod.auditoriaIA.nome === mod.nome && mod.auditoriaIA.qtdNos === qtdNos;
}

function _isModeloAuditado(mod) {
    if (window.AcervoManager && typeof AcervoManager.verificarSeModeloAuditado === 'function') {
        return AcervoManager.verificarSeModeloAuditado(mod);
    }
    if (!mod || !mod.auditoriaIA) return false;
    const qtdNos = Array.isArray(mod.nos) ? mod.nos.length : 0;
    return mod.auditoriaIA.nome === mod.nome && mod.auditoriaIA.qtdNos === qtdNos;
}

// --- HELPER VISUAL (Fábrica de SVGs) ---
function getIconeAcervoSVG(intencao) {
    const map = {
        'comando': `<svg viewBox="0 0 24 24" fill="none" stroke="#c62828" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>`,
        'texto': `<svg viewBox="0 0 24 24" fill="none" stroke="#1565c0" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`,
        'nota': `<svg viewBox="0 0 24 24" fill="none" stroke="#616161" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
        'premissa': `<svg viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`,
        'fundamentacao': `<svg viewBox="0 0 24 24" fill="none" stroke="#00695c" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`,
        'refutacao': `<svg viewBox="0 0 24 24" fill="none" stroke="#8B4513" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>`,
        'preliminar': `<svg viewBox="0 0 24 24" fill="none" stroke="#5d4037" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        'veredito': `<svg viewBox="0 0 24 24" fill="none" stroke="#e65100" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
        'jurisprudencia': `<svg viewBox="0 0 24 24" fill="none" stroke="#00838F" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><path d="M12 10l-2-2m0 0l-2 2m2-2v6"></path></svg>`,
        'degravacao': `<svg viewBox="0 0 24 24" fill="none" stroke="#BF360C" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>`
    };
    return map[intencao] || map['premissa'];
}

window.atualizarIconeAcervoUI = function(selectElement) {
    const container = selectElement.closest('.acervo-node-edit-box');
    const iconDiv = container.querySelector('.svg-icon-wrapper');
    const intencao = selectElement.value;
    
    if (iconDiv && typeof getIconeAcervoSVG === 'function') {
        iconDiv.innerHTML = getIconeAcervoSVG(intencao);
        iconDiv.className = `svg-icon-wrapper sub-badge has-intent intencao-${intencao} modal-static-badge`;
    }
};

// Filtro totalmente em memória (RAM Speed)
window.filtrarListaUI = function(termo, listaId) { // listaId mantido para retrocompatibilidade
    // GUARD CLAUSE: Impede mutação do DOM durante transições ou modo foco ativo
    const focusView = document.getElementById('acervo-focus-view');
    const isFocoAtivo = focusView && focusView.classList.contains('is-active');
    
    if (_isViewTransitioning || isFocoAtivo) {
        console.warn("[Acervo] Mutação de lista bloqueada: UI travada pelo modo foco.");
        return; 
    }

    const termoMin = termo.toLowerCase().trim();
    
    if (!termoMin) {
        _modelosFiltrados = [..._todosModelosEmMemoria];
    } else {
        _modelosFiltrados = _todosModelosEmMemoria.filter(mod => {
            const titulo = mod.nome.toLowerCase();
            const tagsData = (mod.tags || []).join(' ').toLowerCase();
            return titulo.includes(termoMin) || tagsData.includes(termoMin);
        });
    }

    _paginaAtualRenderizacao = 0;
    
    // Limpeza SEGURA - Apenas o wrapper!
    const wrapper = document.getElementById('acervo-items-wrapper');
    if(wrapper) wrapper.innerHTML = ''; 
    
    if (_modelosFiltrados.length === 0) {
        if(wrapper) wrapper.innerHTML = '<p class="empty-state">Nenhum modelo encontrado para esta pesquisa.</p>';
        const sentinela = document.getElementById('sentinela-scroll-acervo');
        if(sentinela) sentinela.style.display = 'none';
        return;
    }

    // Debounce em 150ms chamará a renderização inicial indiretamente, mas forçamos a primeira para UX.
    renderizarProximoLoteAcervo();
};

window.debounce = function(func, wait) {
    let timeout;
    const debounced = function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
    debounced.cancel = () => clearTimeout(timeout);
    return debounced;
};
window.filtrarListaUIDebounced = window.debounce(window.filtrarListaUI, 300);

// ==========================================
// MÓDULO 1: SALVAR NO ACERVO
// ==========================================

// 1. Definição do Cache de Estado (Isolado)
let _modelosSalvarCache = [];

window.abrirModalSalvarModelo = function() {
    if (!window.AcervoManager) return exibirToast('Conecte-se ao Firebase primeiro.', 'erro');
    if (typeof _menuSubAnotacaoCtx === 'undefined' || !_menuSubAnotacaoCtx) return;
    
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const alvo = (typeof _resolverSubAlvo === 'function') 
        ? _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource)
        : topico.anotacoes[_menuSubAnotacaoCtx.parentIndex];
    
    _noAlvoParaSalvar = alvo.subAnotacoes[_menuSubAnotacaoCtx.localIndex];

    // Detecta o escopo de forma agnóstica
    let escopoDetectado = 'card';
    if (_menuSubAnotacaoCtx.viewSource === 'global') escopoDetectado = 'global';
    else if (typeof _menuSubAnotacaoCtx.viewSource === 'string' && _menuSubAnotacaoCtx.viewSource.startsWith('tese:')) escopoDetectado = 'tese';
    
    _noAlvoParaSalvar.escopoOriginal = escopoDetectado;

    document.getElementById('sub-annotation-context-menu').style.display = 'none';
    document.querySelector('input[name="modo_salvar_modelo"][value="novo"]').checked = true;
    document.getElementById('input-nome-modelo').value = '';
    
    // Limpeza de segurança na abertura
    const inputBusca = document.getElementById('input-busca-modelo');
    if (inputBusca) inputBusca.value = '';
    
    document.getElementById('wizard-backdrop').style.display = 'block';
    document.getElementById('modal-salvar-modelo').style.display = 'flex';
    window.toggleModoSalvarModelo(); 
};

window.toggleModoSalvarModelo = function() {
    const isNovo = document.querySelector('input[name="modo_salvar_modelo"]:checked').value === 'novo';
    document.getElementById('box-modelo-novo').style.display = isNovo ? 'block' : 'none';
    document.getElementById('box-modelo-existente').style.display = isNovo ? 'none' : 'block';
    
    if (!isNovo) {
        const container = document.getElementById('lista-modelos-salvar');
        container.innerHTML = '<div class="acervo-loader"></div>';
        
        AcervoManager.carregarModelos().then(modelos => {
            _modelosSalvarCache = modelos; // Popula o cache em memória
            window.renderizarListaSalvarModelos(_modelosSalvarCache); // Aciona renderização dedicada
        }).catch(() => {
            container.innerHTML = '<p style="color:red; font-size:0.8rem;">Erro ao conectar. Faça login.</p>';
        });
    }
};

// 3. Novas Funções de Renderização e Filtro Isoladas
window.renderizarListaSalvarModelos = function(modelosParaRenderizar) {
    const container = document.getElementById('lista-modelos-salvar');
    container.innerHTML = '';
    
    if (modelosParaRenderizar.length === 0) {
        container.innerHTML = '<p style="text-align:center; font-size:0.8rem; padding: 10px 0;">Nenhum modelo encontrado.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    
    modelosParaRenderizar.forEach(mod => {
        const item = document.createElement('div');
        item.className = 'acervo-item';
        
        // Mantém a seleção visual caso haja repintura do DOM após filtro
        if (_modeloSelecionadoId === mod.id) item.classList.add('selected');
        
        item.innerHTML = `<div class="acervo-item-titulo">${TopicsManager.escaparHTML(mod.nome)}</div><div style="font-size:0.7rem; color:#888;">${mod.nos.length} nó(s) salvos</div>`;
        item.onclick = () => {
            document.querySelectorAll('#lista-modelos-salvar .acervo-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            _modeloSelecionadoId = mod.id;
        };
        fragment.appendChild(item);
    });
    
    container.appendChild(fragment);
};

window.filtrarModelosSalvar = function(termo) {
    const termoMin = termo.toLowerCase().trim();
    
    const filtrados = termoMin 
        ? _modelosSalvarCache.filter(mod => mod.nome.toLowerCase().includes(termoMin)) 
        : _modelosSalvarCache;
        
    window.renderizarListaSalvarModelos(filtrados);
};

// Aplicação do Debounce (evita travamento de UI durante a digitação)
window.filtrarModelosSalvarDebounced = window.debounce(window.filtrarModelosSalvar, 300);

// 4. CORREÇÃO CRÍTICA DO CICLO DE VIDA (Teardown)
window.fecharModalSalvarModelo = function() {
    document.getElementById('wizard-backdrop').style.display = 'none';
    document.getElementById('modal-salvar-modelo').style.display = 'none';
    
    // Limpeza de Estado Nativo
    _noAlvoParaSalvar = null;
    
    // NOVA LIMPEZA (Stale State Prevention)
    _modelosSalvarCache = []; // Esvazia a memória
    const inputBusca = document.getElementById('input-busca-modelo');
    if (inputBusca) inputBusca.value = ''; // Limpa o front-end
};

window.confirmarSalvarModelo = async function() {
    if (!_noAlvoParaSalvar) return;
    
    const isNovo = document.querySelector('input[name="modo_salvar_modelo"]:checked').value === 'novo';
    const btnConfirmar = document.querySelector('#btn-confirmar-salvar-modelo') || document.querySelector('#modal-salvar-modelo button.btn-primario') || document.querySelector('#modal-salvar-modelo .chip-autora');
    
    let textoOriginalBtn = 'Confirmar';
    if (btnConfirmar) {
        textoOriginalBtn = btnConfirmar.innerHTML;
        btnConfirmar.disabled = true;
        btnConfirmar.style.opacity = '0.7';
        btnConfirmar.innerHTML = '⌛ Salvando...';
    }

    try {
        if (isNovo) {
            const nome = document.getElementById('input-nome-modelo').value.trim();
            if (!nome) {
                exibirToast('Defina um nome para o modelo.', 'aviso');
                return;
            }
            await AcervoManager.salvarNovoModelo(nome, _noAlvoParaSalvar);
        } else {
            if (!_modeloSelecionadoId) {
                exibirToast('Selecione um modelo existente.', 'aviso');
                return;
            }
            await AcervoManager.adicionarNoAModelo(_modeloSelecionadoId, _noAlvoParaSalvar);
        }
        
        window.fecharModalSalvarModelo(); 
        exibirToast('Nó salvo no acervo com sucesso!', 'sucesso');

    } catch (e) {
        console.error("[Juris Notes UI] Transação abortada:", e);
        if (e.isCustom) exibirToast(e.message, 'erro');
        else exibirToast(`Falha: ${e.message}`, 'erro');
    } finally {
        if (btnConfirmar) {
            btnConfirmar.disabled = false;
            btnConfirmar.style.opacity = '1';
            btnConfirmar.innerHTML = textoOriginalBtn;
        }
    }
};

// ==========================================
// MÓDULO 2: INSERIR DO ACERVO
// ==========================================
// ==========================================
// CICLO DE VIDA: ABERTURA DO MODAL E INICIALIZAÇÃO
// ==========================================
window.abrirModalAcervo = function() {
    if (!window.AcervoManager) return exibirToast('Conecte-se ao Firebase primeiro.', 'erro');

    if (typeof AcervoManager.carregarConfigTags === 'function') {
        AcervoManager.carregarConfigTags().then(tags => { _tagsGlobais = tags; });
    }
    
    document.getElementById('history-container').classList.add('pdf-foco-ativo');
    document.getElementById('wizard-backdrop').style.display = 'block';
    document.getElementById('modal-acervo-inserir').style.display = 'flex';
    
    // Reset Arquitetural de View
    document.getElementById('modal-acervo-inserir').classList.remove('is-fullscreen');
    document.getElementById('acervo-focus-view').style.display = 'none';
    document.getElementById('acervo-focus-view').classList.remove('is-active');
    
    const listView = document.getElementById('acervo-list-view');
    if (listView) {
        listView.style.display = 'flex';
        listView.style.opacity = '1';
    }
    
    // Tratamento de UI para Filtros IA vs Manual
    if (_idsRecomendadosIA) {
        _safeDisplay('banner-filtro-ia', 'flex');
        _safeDisplay('acervo-search-wrapper', 'none'); 
    } else {
        _safeDisplay('banner-filtro-ia', 'none');
        _safeDisplay('acervo-search-wrapper', 'flex');
        document.getElementById('input-pesquisa-acervo').value = '';
    }
    
    _safeDisplay('box-destino-dinamico-acervo', 'none');
    _safeDisplay('box-preview-acervo', 'none');
    _safeDisplay('btn-inserir-acervo', 'none');
    
    // Reset do Estado de Seleção
    _modeloSelecionadoId = null; 
    _modeloSelecionadoNodes = [];
    
    // Inicializar Event Delegation UMA única vez
    configurarEventDelegation();

    // Reset Visual Seguro (Limpando apenas o Wrapper)
    const wrapper = document.getElementById('acervo-items-wrapper');
    wrapper.innerHTML = '<div class="acervo-loader"></div>';
    
    // Carregamento de Dados
    AcervoManager.carregarModelos().then(modelos => {
        _todosModelosEmMemoria = modelos;
        
        // Aplicação de Filtros Base
        if (_idsRecomendadosIA) {
            _modelosFiltrados = _todosModelosEmMemoria.filter(mod => _idsRecomendadosIA.includes(mod.id));
        } else {
            _modelosFiltrados = [..._todosModelosEmMemoria];
        }

        wrapper.innerHTML = ''; // Limpa o loader de forma segura
        
        if (_modelosFiltrados.length === 0) {
            const msg = _idsRecomendadosIA ? 'Nenhum modelo compatível encontrado pela IA.' : 'Acervo vazio.';
            wrapper.innerHTML = `<p class="empty-state">${msg}</p>`;
            document.getElementById('sentinela-scroll-acervo').style.display = 'none';
            return;
        }

        _paginaAtualRenderizacao = 0;
        iniciarObserverDeRolagem(); // Garante o ciclo do observer
        renderizarProximoLoteAcervo();

    }).catch(() => wrapper.innerHTML = '<p style="color:red; text-align:center;">Erro ao conectar.</p>');
};

// ==========================================
// RENDERIZAÇÃO EM LOTES (CHUNKING / VIRTUALIZAÇÃO)
// ==========================================
function renderizarProximoLoteAcervo() {
    const wrapper = document.getElementById('acervo-items-wrapper');
    const sentinela = document.getElementById('sentinela-scroll-acervo');
    if (!wrapper || !sentinela) return;
    
    const inicio = _paginaAtualRenderizacao * TAMANHO_LOTE_RENDERIZACAO;
    const fim = inicio + TAMANHO_LOTE_RENDERIZACAO;
    const lote = _modelosFiltrados.slice(inicio, fim);

    if (lote.length === 0) return; // Failsafe

    // Injeção de alta performance sem tocar no DOM principal iterativamente
    const fragment = document.createDocumentFragment();

    lote.forEach(mod => {
        const item = document.createElement('div');
        // Adicionamos os atributos data-* para o Event Delegation
        item.className = _idsRecomendadosIA ? 'acervo-item ai-recommended' : 'acervo-item';
        item.dataset.id = mod.id;
        
        const htmlTags = (mod.tags && mod.tags.length > 0) 
            ? `<div class="acervo-item-tags-lista">${mod.tags.map(t => `<span class="acervo-tag-chip">${TopicsManager.escaparHTML(t)}</span>`).join('')}</div>`
            : '';

        const escopoAtual = mod.escopo || 'card';
        let escopoSelo = '';
        if(escopoAtual === 'global') escopoSelo = `<span class="acervo-node-badge" style="background:#e3f2fd; color:#0d47a1; margin-right:6px; padding:2px 6px; border-radius:4px; font-weight:bold;">🌐 Global</span>`;
        if(escopoAtual === 'tese') escopoSelo = `<span class="acervo-node-badge" style="background:#f3e5f5; color:#6a1b9a; margin-right:6px; padding:2px 6px; border-radius:4px; font-weight:bold;">⚖️ Tese</span>`;

        const pontoPendente = !_isModeloAuditado(mod)
            ? `<span class="acervo-pending-dot" title="Modelo novo ou modificado (pendente de auditoria IA)"></span>`
            : '';

        // Remoção completa de eventos inlines (onclick)
        item.innerHTML = `
            <div class="acervo-item-header">
                <div style="flex: 1; pointer-events: none;"> <!-- pointer-events previne falsos alvos no clique -->
                    <div class="acervo-item-titulo" style="display:flex; align-items:center;">${pontoPendente}<span>${TopicsManager.escaparHTML(mod.nome)}</span></div>
                    <div style="font-size:0.7rem; color:#888; margin-top:2px; display:flex; align-items:center;">${escopoSelo} ${mod.nos.length} nó(s) salvos</div>
                    ${htmlTags}
                </div>
                <button class="acervo-action-btn" data-action="edit" data-id="${mod.id}" title="Editar este modelo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
            </div>`;
        
        fragment.appendChild(item);
    });

    wrapper.appendChild(fragment);
    _paginaAtualRenderizacao++;

    // Gerenciamento dinâmico da Sentinela
    if (fim >= _modelosFiltrados.length) {
        sentinela.style.display = 'none'; // Lista chegou ao fim
    } else {
        sentinela.style.display = 'block';
    }
}

// ==========================================
// EVENT DELEGATION (Prevenção de Memory Leaks)
// ==========================================
function configurarEventDelegation() {
    if (_eventDelegationAtivo) return; // Evita duplicação de listeners
    
    const wrapper = document.getElementById('acervo-items-wrapper');
    if (!wrapper) return;

    wrapper.addEventListener('click', (e) => {
        // 1. Verifica se clicou no botão de editar
        const btnEdit = e.target.closest('.acervo-action-btn[data-action="edit"]');
        if (btnEdit) {
            e.stopPropagation();
            abrirEdicaoModeloAcervo(e, btnEdit.dataset.id);
            return;
        }

        // 2. Verifica se clicou no Card do Modelo (para ativar o Foco)
        const card = e.target.closest('.acervo-item');
        if (card) {
            e.preventDefault();
            e.stopPropagation(); // Isola o evento
            selecionarEAtivarModelo(card, card.dataset.id);
        }
    });

    _eventDelegationAtivo = true;
}

// Lógica isolada chamada pelo Event Delegation
function selecionarEAtivarModelo(cardElement, modeloId) {
    // 1. Aborta execuções pendentes e ativa a trava arquitetural
    if (window.filtrarListaUIDebounced && window.filtrarListaUIDebounced.cancel) {
        window.filtrarListaUIDebounced.cancel();
    }
    _isViewTransitioning = true; // Trava o estado

    try {
        document.querySelectorAll('#acervo-items-wrapper .acervo-item').forEach(el => el.classList.remove('selected'));
        cardElement.classList.add('selected');
        
        const mod = _todosModelosEmMemoria.find(m => m.id === modeloId);
        if (!mod) {
            _isViewTransitioning = false; // Libera trava em caso de falha
            return;
        }

        _modeloSelecionadoId = mod.id;
    _modeloSelecionadoNodes = mod.nos;
    _modeloSelecionadoEscopo = mod.escopo || 'card';
    
    const previewHtml = mod.nos.map(n => `
        <div class="acervo-node-preview">
            ${getIconeAcervoSVG(n.intencao)}
            <span class="acervo-node-text wrap-text">${TopicsManager.escaparHTML(n.texto)}</span>
        </div>
    `).join('');
    
    const previewBox = document.getElementById('box-preview-acervo');
    previewBox.innerHTML = previewHtml;
    previewBox.style.display = 'block';
    
    window.ativarModoFocoAcervo(mod.nome);
    
    // Roteamento Defensivo (Legado)
    _safeDisplay('box-destino-dinamico-acervo', 'block');
    _safeDisplay('destino-acervo-card', 'none');
    _safeDisplay('destino-acervo-tese', 'none');
    _safeDisplay('destino-acervo-global', 'none');
    
    const btnInserir = document.getElementById('btn-inserir-acervo');
    if(btnInserir) btnInserir.disabled = false;

    const topico = typeof topicos !== 'undefined' ? topicos.find(t => t.id === TopicsManager.getActiveTabId()) : null;

    if (_modeloSelecionadoEscopo === 'global') {
        _safeDisplay('destino-acervo-global', 'block');
        if(btnInserir) btnInserir.textContent = '✔ Inserir Globalmente';
    } 
    else if (_modeloSelecionadoEscopo === 'tese') {
        _safeDisplay('destino-acervo-tese', 'block');
        if(btnInserir) btnInserir.textContent = '✔ Inserir na Tese';
        
        const selectTese = document.getElementById('select-destino-acervo-tese');
        const aviso = document.getElementById('aviso-sem-tese');
        
        if(selectTese && aviso && topico) {
            selectTese.innerHTML = '<option value="">Selecione uma Tese existente...</option>';
            const tesesUnicas = [...new Set(topico.anotacoes.filter(a => a.tese && a.tese.trim() !== '').map(a => a.tese))];
            
            if (tesesUnicas.length === 0) {
                selectTese.style.display = 'none';
                aviso.style.display = 'block';
                if(btnInserir) btnInserir.disabled = true;
            } else {
                selectTese.style.display = 'block';
                aviso.style.display = 'none';
                tesesUnicas.forEach(t => selectTese.appendChild(new Option(t, t)));
            }
        }
    } else {
        _safeDisplay('destino-acervo-card', 'block');
        if(btnInserir) btnInserir.textContent = '✔ Inserir no Card';
    }

    _safeDisplay('btn-inserir-acervo', 'block');
    
    } catch (error) {
        _isViewTransitioning = false; // Libera trava em caso de erro crítico
        console.error("[AcervoController] Erro ao selecionar modelo:", error);
    }
}

// ==========================================
// INTERSECTION OBSERVER
// ==========================================
function iniciarObserverDeRolagem() {
    const sentinela = document.getElementById('sentinela-scroll-acervo');
    const container = document.getElementById('lista-acervo-geral');
    if (!sentinela || !container) return;

    if (_observerScrollAcervo) _observerScrollAcervo.disconnect();

    _observerScrollAcervo = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) renderizarProximoLoteAcervo();
    }, { 
        root: container, 
        rootMargin: '100px' // Pré-carrega itens 100px antes da sentinela aparecer
    });

    _observerScrollAcervo.observe(sentinela);
}

// ==========================================
// CICLO DE VIDA: FECHAMENTO DO MODAL
// ==========================================
window.fecharModalAcervo = function() {
    document.getElementById('history-container').classList.remove('pdf-foco-ativo');
    document.getElementById('wizard-backdrop').style.display = 'none';
    document.getElementById('modal-acervo-inserir').style.display = 'none';
    
    // Prevenção Rigorosa de Memory Leaks
    if (_observerScrollAcervo) {
        _observerScrollAcervo.disconnect();
        _observerScrollAcervo = null;
    }
};

window.confirmarInsercaoAcervo = function() {
    if (_modeloSelecionadoNodes.length === 0) return;

    const topicoId = typeof TopicsManager !== 'undefined' ? TopicsManager.getActiveTabId() : null;
    if (!topicoId) return;
    const topico = topicos.find(t => t.id === topicoId);

    // Preparação Imutável de Dados
    const nosParaInjetar = _modeloSelecionadoNodes.map(node => ({
        uuid: 'id-' + crypto.randomUUID(),
        texto: node.texto,
        intencao: node.intencao,
        timestamp: Date.now()
    }));
    
    // VALIDAÇÕES (Sem mutação de estado ainda)
    let arrayDestino = null;

    if (_modeloSelecionadoEscopo === 'global') {
        if (!topico.diretrizesGlobais) topico.diretrizesGlobais = [];
        arrayDestino = topico.diretrizesGlobais;
    } 
    else if (_modeloSelecionadoEscopo === 'tese') {
        const teseEscolhida = document.getElementById('select-destino-acervo-tese').value;
        if (!teseEscolhida) return exibirToast('Selecione uma tese de destino.', 'aviso');
        
        if (!topico.diretrizesPorTese) topico.diretrizesPorTese = {};
        if (!topico.diretrizesPorTese[teseEscolhida]) topico.diretrizesPorTese[teseEscolhida] = [];
        arrayDestino = topico.diretrizesPorTese[teseEscolhida];
    } 
    else {
        const inputVal = document.getElementById('input-destino-acervo-card').value;
        const destinoIdx = parseInt(inputVal, 10) - 1;
        
        if (isNaN(destinoIdx) || destinoIdx < 0 || destinoIdx >= topico.anotacoes.length) {
            return exibirToast('Número de Ideia Principal inválido.', 'erro');
        }
        
        const cardDestino = topico.anotacoes[destinoIdx];
        if (!cardDestino.subAnotacoes) cardDestino.subAnotacoes = [];
        arrayDestino = cardDestino.subAnotacoes;
    }

    // COMMIT TRANSACIONAL (Mutação segura)
    if (arrayDestino) {
        arrayDestino.push(...nosParaInjetar);
        
        if (typeof renderizarTopicos === 'function') renderizarTopicos();
        if (typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
        
        window.fecharModalAcervo();
        exibirToast('Modelo injetado com sucesso no nível correto!', 'sucesso');
    }
};

window.alterarEscopoModeloAtual = async function(novoEscopo) {
    if (!_modeloSelecionadoId) return;
    try {
        await AcervoManager.atualizarEscopoDoModelo(_modeloSelecionadoId, novoEscopo);
        exibirToast('Nível hierárquico atualizado.', 'sucesso');
    } catch(e) {
        exibirToast('Erro ao atualizar nível na nuvem.', 'erro');
    }
};

// ==========================================
// EDIÇÃO DE MODELOS DO ACERVO E TAGS
// ==========================================
window.abrirEdicaoModeloAcervo = async function(event, modeloId) {
    if(event) event.stopPropagation(); 
    document.getElementById('modal-acervo-inserir').style.display = 'none';
    _modeloSelecionadoId = modeloId;

    const modelos = await AcervoManager.carregarModelos();
    const modelo = modelos.find(m => m.id === modeloId);
    if(!modelo) return;

    document.getElementById('edit-modelo-nome').textContent = modelo.nome;
    _tagsModeloEmEdicao = modelo.tags ? [...modelo.tags] : [];
    
    const selectEscopo = document.getElementById('select-edicao-escopo');
    if (selectEscopo) selectEscopo.value = modelo.escopo || 'card';
    
    const containerTags = document.getElementById('container-checkboxes-tags');
    containerTags.innerHTML = `
        <div style="position: relative; width: 100%;">
            <input type="text" id="input-busca-tags-modelo" class="topic-select" placeholder="Digite para buscar e vincular uma tag..." 
                oninput="filtrarDropdownTags(this.value)" 
                onfocus="abrirDropdownTags()" 
                onblur="fecharDropdownTags()">
            <div id="dropdown-tags-modelo" class="tags-dropdown-menu" style="display: none;"></div>
        </div>
        <div id="container-tags-selecionadas" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; width: 100%;"></div>
    `;

    renderizarTagsSelecionadas(modeloId);

    const container = document.getElementById('lista-edicao-nos-acervo');
    container.innerHTML = '';

    const listaIntencoes = [
        { val: 'premissa', label: 'Premissa Lógica' }, { val: 'comando', label: 'Comando Direto' },
        { val: 'texto', label: 'Texto Fixo' }, { val: 'nota', label: 'Nota Oculta' },
        { val: 'veredito', label: 'Veredito / Conclusão' }, { val: 'fundamentacao', label: 'Lei Seca' },
        { val: 'refutacao', label: 'Refutação (Mérito)' }, { val: 'preliminar', label: 'Filtro / Prejudicial' },
        { val: 'jurisprudencia', label: 'Jurisprudência Exata' }, { val: 'degravacao', label: 'Degravação Curada' }
    ];

    modelo.nos.forEach((no, index) => {
        const box = document.createElement('div');
        box.className = 'acervo-node-edit-box';
        
        const optionsHtml = listaIntencoes.map(i => 
            `<option value="${i.val}" ${no.intencao === i.val ? 'selected' : ''}>${i.label}</option>`
        ).join('');

        const iconClass = `svg-icon-wrapper sub-badge has-intent intencao-${no.intencao} modal-static-badge`;

        box.innerHTML = `
            <div class="${iconClass}">${typeof getIconeAcervoSVG === 'function' ? getIconeAcervoSVG(no.intencao) : '📄'}</div>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                <select id="edit-intencao-${modeloId}-${index}" class="topic-select" style="padding: 4px 8px; font-size: 0.75rem; width: fit-content;" onchange="window.atualizarIconeAcervoUI(this)">
                    ${optionsHtml}
                </select>
                <textarea class="acervo-node-edit-textarea" id="edit-no-${modeloId}-${index}" style="width: 100%;">${TopicsManager.escaparHTML(no.texto)}</textarea>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
                <button class="acervo-action-btn" title="Salvar Alteração" onclick="salvarTextoNoAcervo('${modeloId}', ${index})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
                <button class="acervo-action-btn delete-btn" title="Excluir Nó" onclick="excluirNoAcervo('${modeloId}', ${index})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
        container.appendChild(box);
    });

    _sincronizarBotaoAuditoriaModalEdicao(_isModeloAuditado(modelo));
    document.getElementById('modal-editar-modelo-acervo').style.display = 'flex';
};

function _sincronizarBotaoAuditoriaModalEdicao(isAuditado) {
    const btn = document.getElementById('btn-toggle-auditado-modelo');
    if (!btn) return;
    btn.className = `acervo-audit-toggle-btn ${isAuditado ? 'is-audited' : 'is-pending'}`;
    btn.textContent = isAuditado ? '✔ Auditado IA' : '⏳ Pendente IA';
    btn.dataset.auditado = isAuditado ? 'true' : 'false';
}

window.alternarStatusAuditoriaModeloAtual = async function() {
    if (!_modeloSelecionadoId || !window.AcervoManager) return;
    const btn = document.getElementById('btn-toggle-auditado-modelo');
    const estadoAtual = btn && btn.dataset.auditado === 'true';
    const novoEstado = !estadoAtual;

    try {
        await AcervoManager.definirStatusAuditoriaModelo(_modeloSelecionadoId, novoEstado);
        _sincronizarBotaoAuditoriaModalEdicao(novoEstado);
        exibirToast(novoEstado ? 'Modelo marcado como Auditado pela IA.' : 'Modelo marcado como Pendente de auditoria.', 'sucesso');
    } catch (e) {
        exibirToast('Erro ao atualizar status de auditoria.', 'erro');
    }
};

function renderizarTagsSelecionadas(modeloId) {
    const container = document.getElementById('container-tags-selecionadas');
    container.innerHTML = _tagsModeloEmEdicao.map(tag => `
        <div class="acervo-tag-chip">
            ${TopicsManager.escaparHTML(tag)}
            <span class="chip-remover" onclick="removerTagDoModelo('${TopicsManager.escaparHTML(tag)}', '${modeloId}')">×</span>
        </div>
    `).join('') || '<span style="font-size:0.75rem; color:#888;">Nenhuma tag vinculada.</span>';
}

window.adicionarTagAoModelo = async function(tagStr, modeloId) {
    if (_tagsModeloEmEdicao.includes(tagStr)) return;
    _tagsModeloEmEdicao.push(tagStr);
    renderizarTagsSelecionadas(modeloId);
    document.getElementById('input-busca-tags-modelo').value = '';
    window.fecharDropdownTags();

    try { 
        await AcervoManager.atualizarTagsDoModelo(modeloId, _tagsModeloEmEdicao); 
    } catch (e) { 
        _tagsModeloEmEdicao.pop();
        renderizarTagsSelecionadas(modeloId);
        exibirToast('Erro de rede ao salvar tag.', 'erro'); 
    }
};

window.removerTagDoModelo = async function(tagStr, modeloId) {
    const index = _tagsModeloEmEdicao.indexOf(tagStr);
    if (index === -1) return;
    
    _tagsModeloEmEdicao.splice(index, 1);
    renderizarTagsSelecionadas(modeloId);

    try { 
        await AcervoManager.atualizarTagsDoModelo(modeloId, _tagsModeloEmEdicao); 
    } catch (e) { 
        _tagsModeloEmEdicao.splice(index, 0, tagStr);
        renderizarTagsSelecionadas(modeloId);
        exibirToast('Erro ao remover tag.', 'erro'); 
    }
};

window.abrirDropdownTags = function() { window.filtrarDropdownTags(document.getElementById('input-busca-tags-modelo').value); };
window.fecharDropdownTags = function() { document.getElementById('dropdown-tags-modelo').style.display = 'none'; };

window.filtrarDropdownTags = function(termo) {
    const termoMin = termo.toLowerCase().trim();
    const dropdown = document.getElementById('dropdown-tags-modelo');
    
    const tagsDisponiveis = _tagsGlobais.filter(t => t.toLowerCase().includes(termoMin) && !_tagsModeloEmEdicao.includes(t));

    let html = '';
    if (tagsDisponiveis.length === 0 && !termoMin) {
        html = `<div style="padding:10px 12px; font-size:0.8rem; color:#888;">Nenhuma tag disponível.</div>`;
    } else {
        html += tagsDisponiveis.map(tag => `
            <div class="tag-dropdown-item" data-action="vincular" data-tag="${TopicsManager.escaparHTML(tag)}">+ ${TopicsManager.escaparHTML(tag)}</div>
        `).join('');
    }

    const tagExataExiste = _tagsGlobais.some(t => t.toLowerCase() === termoMin);
    
    if (termoMin && !tagExataExiste && !_tagsModeloEmEdicao.includes(termo)) {
        html += `<div class="tag-dropdown-item criar-nova" data-action="criar" data-tag="${TopicsManager.escaparHTML(termo)}">✨ Criar e vincular nova tag: <strong>${TopicsManager.escaparHTML(termo)}</strong></div>`;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
};

document.addEventListener('mousedown', function(event) {
    const dropdownItem = event.target.closest('.tag-dropdown-item');
    if (!dropdownItem) return;
    event.preventDefault(); 

    const action = dropdownItem.dataset.action;
    const tag = dropdownItem.dataset.tag;

    if (!tag || !_modeloSelecionadoId) return;

    if (action === 'vincular') window.adicionarTagAoModelo(tag, _modeloSelecionadoId);
    else if (action === 'criar') window.criarEAdicionarTagInline(tag);
});

window.criarEAdicionarTagInline = async function(novaTag) {
    const tag = novaTag.trim();
    if(!tag) return;

    _tagsGlobais.push(tag);
    try {
        if(window.AcervoManager && typeof AcervoManager.salvarConfigTags === 'function') {
            await AcervoManager.salvarConfigTags(_tagsGlobais);
        }
        await window.adicionarTagAoModelo(tag, _modeloSelecionadoId);
        exibirToast(`Tag "${tag}" criada e vinculada com sucesso!`, 'sucesso');
    } catch(e) {
        _tagsGlobais = _tagsGlobais.filter(t => t !== tag);
        exibirToast('Falha de conexão. A tag não pôde ser salva.', 'erro');
    }
};

window.abrirModalGerenciarTags = async function() {
    document.getElementById('modal-acervo-inserir').style.display = 'none';
    renderizarListaTagsGlobais();
    document.getElementById('modal-gerenciar-tags').style.display = 'flex';
    await _atualizarPlacarAuditoriaModalTags();
};

async function _atualizarPlacarAuditoriaModalTags() {
    const badgeResumo = document.getElementById('badge-resumo-auditoria-acervo');
    const btnMarcarBase = document.getElementById('btn-marcar-base-atual-auditada');
    if (!badgeResumo || !window.AcervoManager) return;

    try {
        const modelos = await AcervoManager.carregarModelos();
        const total = modelos.length;
        const auditados = modelos.filter(_isModeloAuditado).length;
        const pendentes = total - auditados;
        badgeResumo.textContent = `${pendentes} pendente(s) • ${auditados} auditado(s) (Total: ${total})`;
        if (btnMarcarBase) {
            btnMarcarBase.style.display = pendentes > 0 ? 'inline-block' : 'none';
        }
    } catch (e) {
        badgeResumo.textContent = 'Indisponível';
    }
}

window.marcarBaseAtualComoAuditada = async function() {
    if (!window.AcervoManager) return;
    const modelos = await AcervoManager.carregarModelos(true);
    const pendentes = modelos.filter(m => !_isModeloAuditado(m));
    if (pendentes.length === 0) return exibirToast('Todos os modelos já estão marcados como auditados.', 'aviso');

    if (!confirm(
        `Deseja marcar todos os ${pendentes.length} modelo(s) pendentes atuais como "Auditados pela IA"?\n\n` +
        `Use esta opção se a sua base atual já passou por padronização e você deseja exportar apenas os modelos novos criados a partir de agora.`
    )) return;

    try {
        const operacoes = pendentes.map(mod => ({
            id: mod.id,
            novoNome: null,
            auditoriaIA: AcervoManager.criarAssinaturaAuditoria(
                mod.nome,
                Array.isArray(mod.nos) ? mod.nos.length : 0,
                'bootstrap-manual'
            )
        }));
        const gravados = await AcervoManager.renomearModelosEmLote(operacoes);
        await _atualizarPlacarAuditoriaModalTags();
        exibirToast(`${gravados} modelo(s) marcados como auditados!`, 'sucesso');
    } catch (e) {
        exibirToast(e.message || 'Erro ao marcar base atual.', 'erro');
    }
};

window.fecharModalGerenciarTags = function() {
    document.getElementById('modal-gerenciar-tags').style.display = 'none';
    window.abrirModalAcervo();
};

function renderizarListaTagsGlobais() {
    const container = document.getElementById('lista-tags-globais');
    container.innerHTML = _tagsGlobais.map((tag, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#fafafa; padding:6px 10px; border:1px solid #eee; border-radius:4px; margin-bottom:4px;">
            <span class="acervo-tag-chip">${TopicsManager.escaparHTML(tag)}</span>
            <div style="display:flex; gap:4px;">
                <button class="acervo-action-btn" onclick="editarTagGlobal(${idx})" title="Renomear Tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                <button class="acervo-action-btn delete-btn" onclick="excluirTagGlobal(${idx})" title="Excluir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
        </div>
    `).join('') || '<p style="font-size:0.8rem; color:#888;">Nenhuma tag criada.</p>';
}

window.adicionarTagGlobal = async function() {
    const input = document.getElementById('input-nova-tag');
    const valor = input.value.trim();
    if(!valor || _tagsGlobais.includes(valor)) return exibirToast('Tag inválida ou já existe.', 'erro');
    
    _tagsGlobais.push(valor);
    try {
        if(window.AcervoManager && typeof AcervoManager.salvarConfigTags === 'function') await AcervoManager.salvarConfigTags(_tagsGlobais);
        input.value = '';
        renderizarListaTagsGlobais();
    } catch(e) { 
        exibirToast('Erro ao salvar tag.', 'erro'); 
        _tagsGlobais.pop(); 
    }
};

window.editarTagGlobal = async function(idx) {
    const tagAntiga = _tagsGlobais[idx];
    const novoNome = await JurisPrompt.ask(
        '️ Renomear Tag', 
        'Renomear tag (Isso atualizará TODOS os modelos que utilizam esta tag):', 
        'Novo nome da tag...', 
        tagAntiga
    );
    
    if (!novoNome || novoNome.trim() === '' || novoNome.trim() === tagAntiga) return;
    
    const nomeLimpo = novoNome.trim();
    if (_tagsGlobais.includes(nomeLimpo)) return exibirToast('Esta tag já existe.', 'erro');

    _tagsGlobais[idx] = nomeLimpo; 
    try {
        await AcervoManager.salvarConfigTags(_tagsGlobais);
        await AcervoManager.atualizarTagEmTodosModelos(tagAntiga, nomeLimpo);
        renderizarListaTagsGlobais();
        exibirToast('Tag renomeada com sucesso!', 'sucesso');
    } catch(e) { 
        _tagsGlobais[idx] = tagAntiga; 
        exibirToast('Erro ao renomear tag.', 'erro'); 
    }
};

window.excluirTagGlobal = async function(idx) {
    const tagAntiga = _tagsGlobais[idx];
    if(!confirm(`Excluir a tag "${tagAntiga}"?\nEla será removida de todos os modelos que a utilizam.`)) return;
    
    const removida = _tagsGlobais.splice(idx, 1)[0];
    try {
        await AcervoManager.salvarConfigTags(_tagsGlobais);
        await AcervoManager.atualizarTagEmTodosModelos(removida, null); 
        renderizarListaTagsGlobais();
        exibirToast('Tag excluída.', 'sucesso');
    } catch(e) { 
        _tagsGlobais.splice(idx, 0, removida);
        exibirToast('Erro ao excluir tag.', 'erro');
    }
};

window.fecharModalEdicaoAcervo = function() {
    document.getElementById('modal-editar-modelo-acervo').style.display = 'none';
    window.abrirModalAcervo(); 
};

window.salvarTextoNoAcervo = async function(modeloId, nodeIndex) {
    const textarea = document.getElementById(`edit-no-${modeloId}-${nodeIndex}`);
    const seletor = document.getElementById(`edit-intencao-${modeloId}-${nodeIndex}`);
    const novoTexto = textarea.value.trim();
    const novaIntencao = seletor ? seletor.value : 'premissa';

    if(!novoTexto) return exibirToast('O texto não pode ser vazio.', 'aviso');

    try {
        await AcervoManager.atualizarNoDoModelo(modeloId, nodeIndex, { texto: novoTexto, intencao: novaIntencao });
        exibirToast('Atualizado com sucesso!', 'sucesso');
    } catch(e) { 
        exibirToast('Erro ao atualizar na nuvem.', 'erro'); 
    }
};

window.excluirNoAcervo = async function(modeloId, nodeIndex) {
    const modelos = await AcervoManager.carregarModelos();
    const modelo = modelos.find(m => m.id === modeloId);
    if (!modelo) return;

    if (modelo.nos.length === 1) {
        if (!confirm(`ATENÇÃO: Este é o último nó do modelo!\n\nAo excluí-lo, o modelo "${modelo.nome}" será inteiramente apagado do acervo.\nDeseja continuar?`)) return;
        try {
            await AcervoManager.excluirModeloCompleto(modeloId);
            exibirToast('Último nó removido e modelo excluído.', 'sucesso');
            window.fecharModalEdicaoAcervo();
            window.abrirModalAcervo(); 
        } catch(e) { exibirToast('Erro de permissão ou rede ao excluir o modelo.', 'erro'); }
        return; 
    } 

    if (!confirm('Tem certeza que deseja excluir este nó do modelo?')) return;
    try {
        await AcervoManager.removerNoDoModelo(modeloId, nodeIndex);
        exibirToast('Nó excluído com sucesso.', 'sucesso');
        window.abrirEdicaoModeloAcervo(null, modeloId);
    } catch(e) { exibirToast('Erro ao excluir nó.', 'erro'); }
};

window.acionarRenomearModeloAtual = async function() {
    if (!_modeloSelecionadoId) return exibirToast('Nenhum modelo selecionado.', 'erro');
    const nomeElemento = document.getElementById('edit-modelo-nome');
    const nomeAtual = nomeElemento.textContent;
    
    const novoNome = await JurisPrompt.ask(
        '️ Renomear Modelo', 
        'Digite o novo título para este modelo do acervo:', 
        'Novo título...', 
        nomeAtual
    );
    
    if (novoNome === null || novoNome.trim() === '' || novoNome.trim() === nomeAtual) return;

    try {
        await AcervoManager.renomearModelo(_modeloSelecionadoId, novoNome.trim());
        exibirToast('Modelo renomeado com sucesso!', 'sucesso');
        nomeElemento.textContent = novoNome.trim();
    } catch(e) { 
        exibirToast('Erro ao renomear modelo na nuvem.', 'erro'); 
    }
};

window.acionarExcluirModeloAtual = async function() {
    if (!_modeloSelecionadoId) return;
    const nomeAtual = document.getElementById('edit-modelo-nome').textContent;
    
    if (!confirm(`ATENÇÃO: Você está prestes a excluir definitivamente o modelo "${nomeAtual}" e todos os seus dados.\n\nEsta ação NÃO pode ser desfeita. Confirmar exclusão?`)) return;

    try {
        await AcervoManager.excluirModeloCompleto(_modeloSelecionadoId);
        exibirToast('Modelo excluído permanentemente.', 'sucesso');
        window.fecharModalEdicaoAcervo(); 
        window.abrirModalAcervo(); 
    } catch(e) { exibirToast('Erro de permissão ou rede ao excluir o modelo.', 'erro'); }
};

// ==========================================
// MÓDULO 3: EXPORTAÇÃO PARA IA (GOVERNANÇA)
// ==========================================

function _downloadTextoComoArquivo(nomeArquivo, conteudoTexto) {
    const blob = new Blob([conteudoTexto], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.setAttribute('href', url);
    link.setAttribute('download', nomeArquivo);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 150);
}

function _obterChaveStorageLoteLocal() {
    const meta = document.querySelector('meta[name="juris-module"]');
    const mod = meta ? meta.content : 'ro';
    return `juris_historico_lotes_ia_${mod}`;
}

function _salvarLoteNoStorageLocal(loteInfo) {
    if (!loteInfo || !loteInfo.loteId) return;
    try {
        const chave = _obterChaveStorageLoteLocal();
        const atual = JSON.parse(localStorage.getItem(chave) || '{"historico":{}}');
        if (!atual.historico) atual.historico = {};
        atual.ultimoLoteId = loteInfo.loteId;
        atual.historico[loteInfo.loteId] = loteInfo;
        localStorage.setItem(chave, JSON.stringify(atual));
    } catch (e) { /* storage indisponível */ }
}

// Busca estrita por loteId: NÃO faz fallback para ultimoLoteId
function _lerLoteDoStorageLocalEstrito(loteIdEspecifico) {
    if (!loteIdEspecifico) return null;
    try {
        const chave = _obterChaveStorageLoteLocal();
        const atual = JSON.parse(localStorage.getItem(chave) || 'null');
        if (!atual || !atual.historico) return null;
        return atual.historico[loteIdEspecifico] || null;
    } catch (e) {
        return null;
    }
}

function _montarPromptAuditoria({ modo, loteId, qtdPendentes, qtdReferencia, totalPendentesModulo }) {
    const temSecao1 = qtdReferencia > 0;
    const isCompleto = modo === 'completo';

    let prompt = `# PERSONA E CONTEXTO
Atue como um Engenheiro de Conhecimento e Especialista em Taxonomia Jurídica.
Você recebeu um arquivo de exportação do sistema "Juris Notes" referente ao Lote de Auditoria "${loteId}".\n`;

    if (temSecao1) {
        prompt += `- A SEÇÃO 1 contém ${qtdReferencia} modelo(s) JÁ AUDITADO(S) (apenas Nome, Escopo e Tags). Use-a exclusivamente como RÉGUA DE PADRÃO para manter a mesma estrutura terminológica e evitar criar nomes duplicados.
- A SEÇÃO 2 contém ${qtdPendentes} modelo(s) PENDENTE(S) (de um total de ${totalPendentesModulo}) com seu conteúdo integral (Nós de Ideia) para serem auditados nesta rodada.\n`;
    } else {
        prompt += `- O arquivo contém um lote de ${qtdPendentes} modelo(s) (de um total de ${totalPendentesModulo}) com seu conteúdo integral (Nós de Ideia) para auditoria taxonômica.\n`;
    }

    prompt += `
# A REGRA DE OURO: O FILTRO DE TOLERÂNCIA
Sua missão NÃO é reescrever nomes por perfeccionismo estilístico. Aplique um "Filtro de Bom Senso":
- Se um modelo já possui um título descritivo, claro e funcional${temSecao1 ? ' (alinhado ao padrão da Seção 1)' : ''}, classifique-o como [ADEQUADO].
- Aponte como [CRÍTICO] apenas os outliers: títulos vagos, genéricos demais, confusos ou fora do padrão lógico do gabinete.

# ENTREGAS ESPERADAS
1. Diagnóstico de Nomenclatura e Padrão Utilizado
Explicite a estrutura lógica adotada como régua (ex: [Tema Principal] - [Subtema] - [Especificidade]).

2. Tabela de Resgate (De -> Para)
Apresente uma tabela contendo APENAS os modelos em estado [CRÍTICO] que precisam mudar de nome.
Colunas: "ID do Modelo" | "Nome Problemático Atual" | "Sugestão de Novo Nome" | "Motivo da Alteração".

3. Resgate de Órfãos ${isCompleto ? 'e Auditoria Global de Tags' : '(Modelos Sem Tags)'}
Liste os modelos analisados que estão com status [SEM TAGS] e sugira de 2 a 3 tags precisas para cada um.${isCompleto ? '\nAponte também eventuais tags sinônimas/duplicadas na base e sugira uma Árvore Taxonômica Essencial para o gabinete.' : ''}

4. Bloco de Importação e Homologação Automática (OBRIGATÓRIO PARA O SISTEMA)
Ao final da resposta, gere OBRIGATORIAMENTE o bloco abaixo.
REGRA DE INTEGRIDADE: Emita exatamente UMA linha para cada um dos ${qtdPendentes} modelos analisados neste lote:
- Se o modelo for [CRÍTICO] (precisa mudar de nome), use: ID_DO_MODELO ||| Nome Problemático Atual Exato ||| Sugestão de Novo Nome
- Se o modelo for [ADEQUADO] (nome mantido sem alteração), use: ID_DO_MODELO ||| <OK>
Não omita o cabeçalho LOTE e não omita a tag de fechamento <<<FIM_JURIS_RENOMEAR>>>:

<<<JURIS_RENOMEAR>>>
LOTE: ${loteId}
ID_DO_MODELO ||| Nome Problemático Atual Exato ||| Sugestão de Novo Nome
ID_DO_MODELO_ADEQUADO ||| <OK>
<<<FIM_JURIS_RENOMEAR>>>`;

    return prompt;
}

window.exportarBaseParaNotebookLM = async function(event) {
    if (!window.AcervoManager) return exibirToast('Conecte-se ao Firebase primeiro.', 'erro');
    
    const btnExport = event ? event.currentTarget : null;
    let textoOriginal = '';
    
    if (btnExport) {
        textoOriginal = btnExport.innerHTML;
        btnExport.innerHTML = '⌛ Compilando...';
        btnExport.disabled = true;
    }

    try {
        const modelos = await AcervoManager.carregarModelos(true);
        if (!modelos || modelos.length === 0) {
            exibirToast('Seu acervo está vazio. Nada para exportar.', 'aviso');
            return;
        }

        const radioModo = document.querySelector('input[name="modo_exportacao_acervo_ia"]:checked');
        let modo = (radioModo && radioModo.value === 'completo') ? 'completo' : 'incremental';

        const selectLimite = document.getElementById('select-tamanho-lote-ia');
        const tamanhoMaximoLote = selectLimite ? (parseInt(selectLimite.value, 10) || 50) : 50;

        const todosAuditados = modelos.filter(_isModeloAuditado);
        let filaCandidatosPendentes = [];

        if (modo === 'incremental') {
            filaCandidatosPendentes = modelos.filter(m => !_isModeloAuditado(m));
            if (filaCandidatosPendentes.length === 0) {
                const confirmarReauditoria = confirm(
                    `🎉 Todos os ${modelos.length} modelos deste módulo já estão com o selo "Auditado IA" em dia!\n\n` +
                    `Deseja iniciar uma rodada de Reauditoria Completa (até ${tamanhoMaximoLote} modelos)?`
                );
                if (!confirmarReauditoria) return;
                modo = 'completo';
            }
        }

        if (modo === 'completo') {
            filaCandidatosPendentes = [...modelos].sort((a, b) => {
                const tA = (a.auditoriaIA && a.auditoriaIA.em) ? a.auditoriaIA.em : 0;
                const tB = (b.auditoriaIA && b.auditoriaIA.em) ? b.auditoriaIA.em : 0;
                if (tA !== tB) return tA - tB;
                return (a.criadoEm || 0) - (b.criadoEm || 0);
            });
        } else {
            filaCandidatosPendentes.sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
        }

        const totalPendentesModulo = filaCandidatosPendentes.length;
        const loteParaAuditoriaProfunda = filaCandidatosPendentes.slice(0, tamanhoMaximoLote);
        const idsNoLote = new Set(loteParaAuditoriaProfunda.map(m => m.id));

        const modelosReferencia = todosAuditados.filter(m => !idsNoLote.has(m.id));

        const sufixoRandom = Math.random().toString(36).substring(2, 6).toUpperCase();
        const dataCurta = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const loteId = `LOTE-${dataCurta}-${sufixoRandom}`;

        let txtConteudo = "=================================================\n";
        txtConteudo += "BASE DE CONHECIMENTO JURIS NOTES - AUDITORIA DE IA\n";
        txtConteudo += `LOTE DE AUDITORIA: ${loteId}\n`;
        txtConteudo += `MODO: ${modo.toUpperCase()} | RODADA: ${loteParaAuditoriaProfunda.length} de ${totalPendentesModulo} modelo(s)\n`;
        txtConteudo += "Data de Exportação: " + new Date().toLocaleString() + "\n";
        txtConteudo += "=================================================\n\n";

        if (modelosReferencia.length > 0) {
            txtConteudo += "=================================================\n";
            txtConteudo += `SEÇÃO 1: ESPELHO TAXONÔMICO (${modelosReferencia.length} MODELOS JÁ PADRONIZADOS - APENAS REFERÊNCIA)\n`;
            txtConteudo += "=================================================\n";
            modelosReferencia.forEach(mod => {
                const tags = (mod.tags && mod.tags.length > 0) ? mod.tags.join(', ') : 'Sem Tags';
                const escopo = mod.escopo ? mod.escopo.toUpperCase() : 'CARD';
                txtConteudo += `- NOME: ${mod.nome} | ESCOPO: ${escopo} | TAGS: [${tags}]\n`;
            });
            txtConteudo += "\n\n";
        }

        txtConteudo += "=================================================\n";
        txtConteudo += `SEÇÃO 2: FILA DE AUDITORIA PROFUNDA (${loteParaAuditoriaProfunda.length} MODELOS NESTE LOTE)\n`;
        txtConteudo += "=================================================\n\n";

        loteParaAuditoriaProfunda.forEach(mod => {
            const tags = (mod.tags && mod.tags.length > 0) ? mod.tags.join(', ') : '[SEM TAGS]';
            const escopo = mod.escopo ? mod.escopo.toUpperCase() : 'CARD';
            
            txtConteudo += `### NOME DO MODELO: ${mod.nome}\n`;
            txtConteudo += `ID DO MODELO: ${mod.id}\n`;
            txtConteudo += `TAGS: ${tags}\n`;
            txtConteudo += `ESCOPO: ${escopo}\n`;
            txtConteudo += `CONTEÚDO (Nós de Ideia):\n`;
            
            if (mod.nos && mod.nos.length > 0) {
                mod.nos.forEach(no => {
                    txtConteudo += `- [${(no.intencao || 'PREMISSA').toUpperCase()}]: ${no.texto}\n`;
                });
            } else {
                txtConteudo += `- [VAZIO]\n`;
            }
            txtConteudo += `\n-------------------------------------------------\n\n`;
        });

        const textareaPrompt = document.getElementById('textarea-prompt-notebooklm');
        if (textareaPrompt) {
            textareaPrompt.value = _montarPromptAuditoria({
                modo,
                loteId,
                qtdPendentes: loteParaAuditoriaProfunda.length,
                qtdReferencia: modelosReferencia.length,
                totalPendentesModulo
            });
        }

        const subtitulo = document.getElementById('subtitulo-exportacao-notebooklm');
        if (subtitulo) {
            subtitulo.textContent = `Lote ${loteId} gerado: auditando ${loteParaAuditoriaProfunda.length} de ${totalPendentesModulo} modelo(s) (+ ${modelosReferencia.length} em índice leve de referência).`;
        }

        _downloadTextoComoArquivo(`JurisNotes_Acervo_${loteId}.txt`, txtConteudo);

        _safeDisplay('modal-gerenciar-tags', 'none');
        _safeDisplay('modal-acervo-inserir', 'none');
        _safeDisplay('wizard-backdrop', 'none');
        
        window.abrirModalPromptNotebookLM();
        setTimeout(() => { window.copiarPromptNotebookLM(true); }, 80);

        const manifestoLote = {
            loteId,
            ids: Array.from(idsNoLote),
            modo,
            criadoEm: Date.now()
        };
        _salvarLoteNoStorageLocal(manifestoLote);
        if (typeof AcervoManager.salvarManifestoLoteIA === 'function') {
            AcervoManager.salvarManifestoLoteIA(manifestoLote);
        }

    } catch (error) {
        console.error("[AcervoController] Erro na exportação:", error);
        exibirToast('Erro ao exportar base de dados.', 'erro');
    } finally {
        if (btnExport) {
            btnExport.innerHTML = textoOriginal;
            btnExport.disabled = false;
        }
    }
};

window.abrirModalPromptNotebookLM = function() {
    document.getElementById('prompt-notebooklm-backdrop').style.display = 'block';
    document.getElementById('modal-prompt-notebooklm').style.display = 'flex';
};

window.fecharModalPromptNotebookLM = function() {
    document.getElementById('prompt-notebooklm-backdrop').style.display = 'none';
    document.getElementById('modal-prompt-notebooklm').style.display = 'none';
    
    const historyContainer = document.getElementById('history-container');
    const pdfContainer = document.getElementById('pdf-container');
    
    if (historyContainer) historyContainer.classList.remove('pdf-foco-ativo');
    if (pdfContainer) pdfContainer.classList.remove('pdf-foco-ativo');
};

window.copiarPromptNotebookLM = function(isAutoCopy = false) {
    const textarea = document.getElementById('textarea-prompt-notebooklm');
    if (!textarea) return;
    
    textarea.select();
    textarea.setSelectionRange(0, 99999);
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textarea.value).then(() => {
            exibirToast('Comando copiado! Cole no NotebookLM.', 'sucesso');
        }).catch(() => {
            if (isAutoCopy) {
                exibirToast('Arquivo baixado! Clique em "📋 Copiar Comando" para copiar o prompt.', 'aviso');
            } else {
                exibirToast('Falha ao copiar comando.', 'erro');
            }
        });
    } else {
        document.execCommand('copy');
        exibirToast('Comando copiado.', 'sucesso');
    }
};

// ==========================================
// FUNÇÕES DE CONTROLE DE VIEW SWAP (ACERVO)
// ==========================================

window.ativarModoFocoAcervo = function(tituloModelo) {
    const tituloEl = document.getElementById('focus-modelo-titulo');
    if (tituloEl) tituloEl.textContent = TopicsManager.escaparHTML(tituloModelo);
    
    const listView = document.getElementById('acervo-list-view');
    const focusView = document.getElementById('acervo-focus-view');
    
    listView.style.opacity = '0';
    setTimeout(() => {
        listView.style.display = 'none';
        focusView.style.display = 'flex';
        void focusView.offsetWidth; 
        focusView.classList.add('is-active');
        setTimeout(() => { _isViewTransitioning = false; }, 50); 
    }, 250);
};

window.desativarModoFocoAcervo = function() {
    _isViewTransitioning = true;
    
    const listView = document.getElementById('acervo-list-view');
    const focusView = document.getElementById('acervo-focus-view');
    
    document.getElementById('modal-acervo-inserir').classList.remove('is-fullscreen');
    focusView.classList.remove('is-active');
    
    setTimeout(() => {
        focusView.style.display = 'none';
        listView.style.display = 'flex';
        void listView.offsetWidth;
        listView.style.opacity = '1';
        
        document.querySelectorAll('#lista-acervo-geral .acervo-item').forEach(el => el.classList.remove('selected'));
        _modeloSelecionadoId = null;
        setTimeout(() => { _isViewTransitioning = false; }, 50);
    }, 250);
};

window.toggleFullscreenAcervo = function() {
    const modal = document.getElementById('modal-acervo-inserir');
    if(modal) modal.classList.toggle('is-fullscreen');
};

// ==========================================
// MÓDULO 4: IMPORTAÇÃO EM LOTE DE RENOMEAÇÕES (IA)
// ==========================================
let _modelosBaseImportacao = [];
let _itensRenomeacaoIA = [];
let _itensHomologacaoExplicitaIA = [];
let _edicoesManuaisRenomeacao = new Map();
let _cacheManifestosSessao = new Map();
let _seqAnaliseRenomeacao = 0;
let _ultimoLoteReversaoIA = null; // Array<{ id, nomeAnterior, nomeAplicado, auditoriaAnterior, foiRenomeado }>
let _loteIdDetectadoNoTexto = null;
let _loteVerificadoComSucesso = false;
let _blocoDelimitadoCompleto = false;
let _modalOrigemImportacao = 'tags';
let _delegacaoImportacaoAtiva = false;

function _normalizarTituloComparacao(texto) {
    if (!texto) return '';
    return String(texto)
        .normalize('NFC')
        .trim()
        .replace(/^[\s"'`*]+|[\s"'`*]+$/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function _limparCampoBrutoImportacao(texto) {
    if (!texto) return '';
    return String(texto)
        .normalize('NFC')
        .trim()
        .replace(/^[\s"'`*]+|[\s"'`*]+$/g, '')
        .replace(/\s+/g, ' ');
}

function _extrairDadosBlocoRenomeacao(textoBruto) {
    if (!textoBruto || !textoBruto.trim()) {
        return { instrucoes: [], loteId: null, temAbertura: false, temFechamento: false };
    }

    const temAbertura = /<<<JURIS_RENOMEAR>>>/i.test(textoBruto);
    const temFechamento = /<<<FIM_JURIS_RENOMEAR>>>|<<<FIM>>>/i.test(textoBruto);

    let escopoTexto = textoBruto;
    const regexBloco = /<<<JURIS_RENOMEAR>>>([\s\S]*?)(?:<<<FIM_JURIS_RENOMEAR>>>|<<<FIM>>>|$)/i;
    const matchBloco = textoBruto.match(regexBloco);
    if (matchBloco && matchBloco[1]) {
        escopoTexto = matchBloco[1];
    }

    let loteIdDetectado = null;
    const matchLote = escopoTexto.match(/^\s*LOTE\s*:\s*([A-Za-z0-9_-]+)\s*$/im);
    if (matchLote && matchLote[1]) {
        loteIdDetectado = matchLote[1].trim();
    }

    const linhas = escopoTexto.split(/\r?\n/);
    const instrucoes = [];

    for (const rawLine of linhas) {
        const linha = rawLine.trim();
        if (!linha || !linha.includes('|||')) continue;
        if (linha.startsWith('#') || linha.startsWith('```')) continue;

        const partes = linha.split('|||').map(_limparCampoBrutoImportacao);
        if (partes.length >= 3) {
            const idInformado = partes[0];
            const nomeAntigo = partes[1];
            const novoNome = partes.slice(2).join(' - ');

            if (idInformado === 'ID_DO_MODELO' || idInformado === 'ID_DO_MODELO_ADEQUADO') continue;
            if (!idInformado && !nomeAntigo) continue;

            const isTokenOk = /^<?(?:OK|ADEQUADO|MANTIDO)>?$/i.test(novoNome);
            instrucoes.push({
                idInformado,
                nomeAntigoInformado: nomeAntigo,
                novoNomeSugerido: novoNome,
                aprovadoExplicito: isTokenOk
            });
        } else if (partes.length === 2) {
            const campo1 = partes[0];
            const campo2 = partes[1];
            if (campo1 === 'ID_DO_MODELO' || campo1 === 'ID_DO_MODELO_ADEQUADO' || campo1 === 'Nome Problemático Atual Exato') continue;

            const isTokenOk = /^<?(?:OK|ADEQUADO|MANTIDO)>?$/i.test(campo2);
            if (isTokenOk) {
                instrucoes.push({
                    idInformado: campo1,
                    nomeAntigoInformado: '',
                    novoNomeSugerido: '',
                    aprovadoExplicito: true
                });
            } else {
                instrucoes.push({
                    idInformado: null,
                    nomeAntigoInformado: campo1,
                    novoNomeSugerido: campo2,
                    aprovadoExplicito: false
                });
            }
        }
    }

    return { instrucoes, loteId: loteIdDetectado, temAbertura, temFechamento };
}

async function _buscarManifestoEstritoPorId(loteId) {
    if (!loteId) return null;
    if (_cacheManifestosSessao.has(loteId)) {
        return _cacheManifestosSessao.get(loteId);
    }

    const local = _lerLoteDoStorageLocalEstrito(loteId);
    if (local) {
        _cacheManifestosSessao.set(loteId, local);
        return local;
    }

    if (window.AcervoManager && typeof AcervoManager.carregarManifestoLoteIA === 'function') {
        const remoto = await AcervoManager.carregarManifestoLoteIA(loteId);
        if (remoto) _salvarLoteNoStorageLocal(remoto);
        _cacheManifestosSessao.set(loteId, remoto || null);
        return remoto || null;
    }

    _cacheManifestosSessao.set(loteId, null);
    return null;
}

window.abrirModalImportarRenomeacoes = async function(origem = 'tags') {
    if (!window.AcervoManager) return exibirToast('Conecte-se ao Firebase primeiro.', 'erro');

    _modalOrigemImportacao = origem;

    _safeDisplay('modal-gerenciar-tags', 'none');
    _safeDisplay('modal-prompt-notebooklm', 'none');
    _safeDisplay('prompt-notebooklm-backdrop', 'none');
    _safeDisplay('modal-acervo-inserir', 'none');
    _safeDisplay('wizard-backdrop', 'none');

    const historyContainer = document.getElementById('history-container');
    if (historyContainer) historyContainer.classList.add('pdf-foco-ativo');

    try {
        _modelosBaseImportacao = await AcervoManager.carregarModelos(true);
    } catch (e) {
        return exibirToast(e.message || 'Erro ao carregar modelos atuais para conferência.', 'erro');
    }

    _itensRenomeacaoIA = [];
    _itensHomologacaoExplicitaIA = [];
    _edicoesManuaisRenomeacao.clear();
    _cacheManifestosSessao.clear();
    _seqAnaliseRenomeacao++;

    const textarea = document.getElementById('textarea-import-renomeacoes');
    if (textarea) textarea.value = '';
    const fileInput = document.getElementById('input-file-renomeacoes');
    if (fileInput) fileInput.value = '';

    _safeDisplay('box-preview-renomeacoes', 'none');
    _safeDisplay('box-homologar-lote-aprovados', 'none');
    _safeDisplay('alerta-integridade-renomeacoes', 'none');
    _atualizarBarraReversaoUI();
    _configurarEventDelegationImportacao();

    const btnConfirmar = document.getElementById('btn-confirmar-renomeacoes-lote');
    if (btnConfirmar) {
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = '✔ Aplicar Atualizações Selecionadas';
    }

    _safeDisplay('importar-renomeacoes-backdrop', 'block');
    _safeDisplay('modal-importar-renomeacoes', 'flex');

    setTimeout(() => { if (textarea) textarea.focus(); }, 50);
};

window.fecharModalImportarRenomeacoes = function() {
    if (window.analisarTextoRenomeacoesDebounced && window.analisarTextoRenomeacoesDebounced.cancel) {
        window.analisarTextoRenomeacoesDebounced.cancel();
    }
    _seqAnaliseRenomeacao++;

    _safeDisplay('importar-renomeacoes-backdrop', 'none');
    _safeDisplay('modal-importar-renomeacoes', 'none');

    _itensRenomeacaoIA = [];
    _itensHomologacaoExplicitaIA = [];
    _edicoesManuaisRenomeacao.clear();

    if (_modalOrigemImportacao === 'notebooklm') {
        window.abrirModalPromptNotebookLM();
    } else {
        document.getElementById('wizard-backdrop').style.display = 'block';
        window.abrirModalGerenciarTags();
    }
};

window.carregarArquivoRenomeacoesIA = function(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const conteudo = e.target.result || '';
        const textarea = document.getElementById('textarea-import-renomeacoes');
        if (textarea) {
            textarea.value = conteudo;
            window.analisarTextoRenomeacoesIA();
        }
    };
    reader.onerror = function() {
        exibirToast('Erro ao ler o arquivo selecionado.', 'erro');
    };
    reader.readAsText(file, 'UTF-8');
};

function _resolverModeloPorIdOuPrefixo(idBruto, mapaPorId) {
    if (!idBruto) return { modelo: null, ambiguo: false };
    const idLimpo = idBruto.trim();
    if (mapaPorId.has(idLimpo)) {
        return { modelo: mapaPorId.get(idLimpo), ambiguo: false };
    }

    const prefixoAlvo = idLimpo.startsWith('mod-') ? idLimpo : `mod-${idLimpo}`;
    if (prefixoAlvo.length >= 10) {
        const candidatos = _modelosBaseImportacao.filter(m => m.id.startsWith(prefixoAlvo));
        if (candidatos.length === 1) return { modelo: candidatos[0], ambiguo: false };
        if (candidatos.length > 1) return { modelo: null, ambiguo: true };
    }
    return { modelo: null, ambiguo: false };
}

window.analisarTextoRenomeacoesIA = async function() {
    const seqAtual = ++_seqAnaliseRenomeacao;

    const textarea = document.getElementById('textarea-import-renomeacoes');
    const boxPreview = document.getElementById('box-preview-renomeacoes');
    const boxHomologar = document.getElementById('box-homologar-lote-aprovados');
    const chkHomologar = document.getElementById('chk-homologar-aprovados-lote');
    const alertaIntegridade = document.getElementById('alerta-integridade-renomeacoes');
    const tituloAlerta = document.getElementById('titulo-alerta-integridade');
    const textoAlerta = document.getElementById('texto-alerta-integridade');
    const btnConfirmar = document.getElementById('btn-confirmar-renomeacoes-lote');

    if (!textarea || !boxPreview) return;

    const { instrucoes, loteId, temAbertura, temFechamento } = _extrairDadosBlocoRenomeacao(textarea.value);

    if (instrucoes.length === 0) {
        boxPreview.style.display = 'none';
        if (boxHomologar) boxHomologar.style.display = 'none';
        if (alertaIntegridade) alertaIntegridade.style.display = 'none';
        _itensRenomeacaoIA = [];
        _itensHomologacaoExplicitaIA = [];
        if (btnConfirmar) {
            btnConfirmar.disabled = true;
            btnConfirmar.textContent = '✔ Aplicar Atualizações Selecionadas';
        }
        return;
    }

    const manifestoAlvo = loteId ? await _buscarManifestoEstritoPorId(loteId) : null;
    if (seqAtual !== _seqAnaliseRenomeacao) return;

    const blocoTruncado = temAbertura && !temFechamento;
    const blocoDelimitadoCompleto = temAbertura && temFechamento;
    const loteVerificado = Boolean(manifestoAlvo && Array.isArray(manifestoAlvo.ids) && manifestoAlvo.ids.length > 0);
    const conjuntoIdsDoLote = loteVerificado ? new Set(manifestoAlvo.ids) : null;
    const isModoCompletoNoLote = Boolean(manifestoAlvo && manifestoAlvo.modo === 'completo');

    _blocoDelimitadoCompleto = blocoDelimitadoCompleto;
    _loteVerificadoComSucesso = loteVerificado;
    _loteIdDetectadoNoTexto = loteId;

    if (alertaIntegridade && tituloAlerta && textoAlerta) {
        if (blocoTruncado) {
            alertaIntegridade.style.display = 'flex';
            tituloAlerta.textContent = '⚠️ Atenção: Fechamento <<<FIM_JURIS_RENOMEAR>>> não encontrado!';
            textoAlerta.textContent = 'A resposta da IA parece ter sido cortada antes do fim. Por segurança, a homologação de modelos sem alteração foi bloqueada neste envio.';
        } else if (blocoDelimitadoCompleto && !loteVerificado) {
            alertaIntegridade.style.display = 'flex';
            tituloAlerta.textContent = loteId
                ? `⚠️ Manifesto do lote "${loteId}" não localizado na nuvem ou neste navegador`
                : '⚠️ Cabeçalho "LOTE:" não encontrado no bloco colado';
            textoAlerta.textContent = 'Por segurança, nenhum item foi marcado automaticamente. Confira a lista e marque manualmente o que desejar aplicar.';
        } else {
            alertaIntegridade.style.display = 'none';
        }
    }

    const mapaPorId = new Map();
    const mapaListaPorNome = new Map();

    _modelosBaseImportacao.forEach(mod => {
        mapaPorId.set(mod.id, mod);
        const chaveNome = _normalizarTituloComparacao(mod.nome);
        if (!mapaListaPorNome.has(chaveNome)) mapaListaPorNome.set(chaveNome, []);
        mapaListaPorNome.get(chaveNome).push(mod);
    });

    const idsJaProcessados = new Set();
    const novasRenomeacoes = [];
    const novasHomologacoesExplicitas = [];

    instrucoes.forEach((inst, idx) => {
        let modeloAlvo = null;
        let statusBase = 'nao-encontrado';
        let motivoAviso = '';

        if (inst.idInformado) {
            const resId = _resolverModeloPorIdOuPrefixo(inst.idInformado, mapaPorId);
            if (resId.modelo) {
                modeloAlvo = resId.modelo;
                if (!inst.aprovadoExplicito && inst.nomeAntigoInformado) {
                    const nomeBancoNorm = _normalizarTituloComparacao(modeloAlvo.nome);
                    const nomeInformadoNorm = _normalizarTituloComparacao(inst.nomeAntigoInformado);
                    if (nomeBancoNorm !== nomeInformadoNorm) {
                        statusBase = 'conferir';
                        motivoAviso = `O ID corresponde a "${modeloAlvo.nome}", que difere do nome antigo informado ("${inst.nomeAntigoInformado}").`;
                    } else {
                        statusBase = 'pronto';
                    }
                } else {
                    statusBase = 'pronto';
                }
            } else if (resId.ambiguo) {
                statusBase = 'nao-encontrado';
                motivoAviso = `Prefixo de ID "${inst.idInformado}" é ambíguo.`;
            } else if (!inst.aprovadoExplicito && inst.nomeAntigoInformado) {
                const candidatosNome = mapaListaPorNome.get(_normalizarTituloComparacao(inst.nomeAntigoInformado)) || [];
                if (candidatosNome.length === 1) {
                    modeloAlvo = candidatosNome[0];
                    statusBase = 'conferir';
                    motivoAviso = `ID "${inst.idInformado}" não localizado; encontrado apenas pelo nome antigo.`;
                } else {
                    statusBase = 'nao-encontrado';
                    motivoAviso = 'ID e nome antigo não localizados no acervo deste módulo.';
                }
            } else {
                return;
            }
        } else {
            const candidatosNome = mapaListaPorNome.get(_normalizarTituloComparacao(inst.nomeAntigoInformado)) || [];
            if (candidatosNome.length === 1) {
                modeloAlvo = candidatosNome[0];
                statusBase = 'conferir';
                motivoAviso = 'Linha sem ID: confira antes de marcar.';
            } else if (candidatosNome.length > 1) {
                modeloAlvo = candidatosNome[0];
                statusBase = 'conferir';
                motivoAviso = `Existem ${candidatosNome.length} modelos com o nome "${inst.nomeAntigoInformado}".`;
            } else {
                statusBase = 'nao-encontrado';
                motivoAviso = 'Nome antigo não localizado no acervo deste módulo.';
            }
        }

        if (modeloAlvo) {
            if (idsJaProcessados.has(modeloAlvo.id)) return;
            idsJaProcessados.add(modeloAlvo.id);

            const pertenceAoLoteVerificado = loteVerificado && conjuntoIdsDoLote.has(modeloAlvo.id);
            const nomeIgualAoAtual = !inst.aprovadoExplicito &&
                (_normalizarTituloComparacao(modeloAlvo.nome) === _normalizarTituloComparacao(inst.novoNomeSugerido));

            if (inst.aprovadoExplicito || nomeIgualAoAtual) {
                if (!blocoDelimitadoCompleto) return;
                if (loteVerificado && !pertenceAoLoteVerificado) return;

                const jaAuditadoNesteMesmoLote = _isModeloAuditado(modeloAlvo) &&
                    modeloAlvo.auditoriaIA &&
                    loteId &&
                    modeloAlvo.auditoriaIA.loteId === loteId;

                if (!jaAuditadoNesteMesmoLote && (!_isModeloAuditado(modeloAlvo) || isModoCompletoNoLote)) {
                    novasHomologacoesExplicitas.push(modeloAlvo);
                }
                return;
            }

            if (!loteVerificado) {
                statusBase = 'conferir';
                if (!motivoAviso) {
                    motivoAviso = 'Lote não verificado: marque manualmente se desejar aplicar esta alteração.';
                }
            } else if (!pertenceAoLoteVerificado && statusBase === 'pronto') {
                statusBase = 'conferir';
                motivoAviso = `Aviso: Este modelo não pertencia ao lote ${loteId}. Confira antes de marcar.`;
            }
        }

        const chaveEstavel = modeloAlvo ? `id:${modeloAlvo.id}` : `raw:${idx}:${inst.nomeAntigoInformado}`;
        const edicaoPrevia = _edicoesManuaisRenomeacao.get(chaveEstavel);

        const novoNomeFinal = edicaoPrevia ? edicaoPrevia.novoNome : inst.novoNomeSugerido;
        const selecionadoDefault = (statusBase === 'pronto' && loteVerificado);
        const selecionadoFinal = (edicaoPrevia && typeof edicaoPrevia.selecionado === 'boolean' && statusBase !== 'nao-encontrado')
            ? edicaoPrevia.selecionado
            : selecionadoDefault;

        novasRenomeacoes.push({
            chaveEstavel,
            modeloId: modeloAlvo ? modeloAlvo.id : null,
            modeloRef: modeloAlvo || null,
            nomeOriginalBanco: modeloAlvo ? modeloAlvo.nome : (inst.nomeAntigoInformado || '(Sem nome)'),
            novoNome: novoNomeFinal,
            statusBase,
            statusEfetivo: statusBase,
            motivoAvisoBase: motivoAviso,
            motivoConflitoNome: '',
            selecionado: selecionadoFinal
        });
    });

    _itensRenomeacaoIA = novasRenomeacoes;
    _itensHomologacaoExplicitaIA = novasHomologacoesExplicitas;

    if (chkHomologar) {
        chkHomologar.checked = Boolean(blocoDelimitadoCompleto && loteVerificado && novasHomologacoesExplicitas.length > 0);
    }

    _renderizarListaHomologadosUI();
    _recalcularConflitosDeNomes();
    _renderizarDOMPreviewRenomeacoes();
};

window.analisarTextoRenomeacoesDebounced = window.debounce(window.analisarTextoRenomeacoesIA, 250);

function _renderizarListaHomologadosUI() {
    const listaHomologar = document.getElementById('lista-homologar-aprovados');
    const sumarioHomologar = document.getElementById('sumario-homologar-aprovados');
    if (!listaHomologar) return;

    listaHomologar.textContent = '';
    if (sumarioHomologar) {
        sumarioHomologar.textContent = `Ver lista dos ${_itensHomologacaoExplicitaIA.length} modelo(s) aprovados sem alteração`;
    }

    const fragment = document.createDocumentFragment();
    _itensHomologacaoExplicitaIA.forEach(mod => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'acervo-homologation-item';

        const nomeSpan = document.createElement('span');
        nomeSpan.textContent = mod.nome;

        const idSpan = document.createElement('span');
        idSpan.className = 'acervo-rename-id-chip';
        idSpan.textContent = mod.id;

        itemDiv.appendChild(nomeSpan);
        itemDiv.appendChild(idSpan);
        fragment.appendChild(itemDiv);
    });

    listaHomologar.appendChild(fragment);
}

function _recalcularConflitosDeNomes() {
    const idsSendoRenomeados = new Set(
        _itensRenomeacaoIA.filter(i => i.modeloId && i.selecionado).map(i => i.modeloId)
    );

    const nomesExistentesNaoRenomeados = new Set();
    _modelosBaseImportacao.forEach(mod => {
        if (!idsSendoRenomeados.has(mod.id)) {
            nomesExistentesNaoRenomeados.add(_normalizarTituloComparacao(mod.nome));
        }
    });

    const contagemNovosNomesNoLote = new Map();
    _itensRenomeacaoIA.forEach(item => {
        if (!item.modeloId || item.statusBase === 'nao-encontrado') return;
        const norm = _normalizarTituloComparacao(item.novoNome);
        if (norm) {
            contagemNovosNomesNoLote.set(norm, (contagemNovosNomesNoLote.get(norm) || 0) + 1);
        }
    });

    _itensRenomeacaoIA.forEach(item => {
        item.motivoConflitoNome = '';
        item.statusEfetivo = item.statusBase;

        if (!item.modeloId || item.statusBase === 'nao-encontrado') return;

        const novoNorm = _normalizarTituloComparacao(item.novoNome);
        const origNorm = _normalizarTituloComparacao(item.nomeOriginalBanco);

        if (!novoNorm) {
            item.statusEfetivo = 'conferir';
            item.motivoConflitoNome = 'O novo nome não pode ficar vazio.';
            return;
        }

        if (novoNorm === origNorm) {
            item.statusEfetivo = 'sem-alteracao';
            item.motivoConflitoNome = 'O nome digitado é igual ao nome atual.';
            item.selecionado = false;
            return;
        } else if (item.statusBase === 'sem-alteracao') {
            item.statusEfetivo = _loteVerificadoComSucesso ? 'pronto' : 'conferir';
        }

        if ((contagemNovosNomesNoLote.get(novoNorm) || 0) > 1) {
            item.statusEfetivo = 'conferir';
            item.motivoConflitoNome = 'Aviso: Outro item desta lista possui exatamente o mesmo novo nome.';
        } else if (nomesExistentesNaoRenomeados.has(novoNorm)) {
            item.statusEfetivo = 'conferir';
            item.motivoConflitoNome = 'Aviso: Já existe outro modelo no acervo com este exato nome.';
        }
    });
}

function _renderizarDOMPreviewRenomeacoes() {
    const boxPreview = document.getElementById('box-preview-renomeacoes');
    const listaEl = document.getElementById('lista-preview-renomeacoes');
    if (!boxPreview || !listaEl) return;

    listaEl.textContent = '';
    const fragment = document.createDocumentFragment();

    _itensRenomeacaoIA.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = `acervo-rename-row status-${item.statusEfetivo}`;
        row.dataset.idx = String(idx);

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'chk-rename-ia';
        chk.dataset.idx = String(idx);
        const desabilitado = (item.statusEfetivo === 'nao-encontrado' || item.statusEfetivo === 'sem-alteracao');
        chk.disabled = desabilitado;
        chk.checked = !desabilitado && Boolean(item.selecionado);
        chk.style.marginTop = '4px';

        const oldCol = document.createElement('div');
        oldCol.className = 'acervo-rename-old-col';

        const oldSpan = document.createElement('span');
        oldSpan.className = 'acervo-rename-old';
        oldSpan.textContent = item.nomeOriginalBanco;
        oldCol.appendChild(oldSpan);

        if (item.modeloId) {
            const idChip = document.createElement('span');
            idChip.className = 'acervo-rename-id-chip';
            idChip.textContent = item.modeloId;
            oldCol.appendChild(idChip);
        }

        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'acervo-rename-arrow';
        arrowSpan.setAttribute('aria-hidden', 'true');
        arrowSpan.textContent = '➔';

        const newCol = document.createElement('div');
        newCol.className = 'acervo-rename-new-col';

        if (item.statusBase !== 'nao-encontrado') {
            const inputNovo = document.createElement('input');
            inputNovo.type = 'text';
            inputNovo.className = 'acervo-rename-new-input';
            if (item.motivoConflitoNome) inputNovo.classList.add('has-conflict');
            inputNovo.dataset.idx = String(idx);
            inputNovo.value = item.novoNome;
            inputNovo.setAttribute('aria-label', `Novo nome para ${item.nomeOriginalBanco}`);
            newCol.appendChild(inputNovo);
        }

        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'acervo-rename-feedback-slot';
        _popularBadgesFeedbackItem(badgeContainer, item);
        newCol.appendChild(badgeContainer);

        row.appendChild(chk);
        row.appendChild(oldCol);
        row.appendChild(arrowSpan);
        row.appendChild(newCol);

        fragment.appendChild(row);
    });

    listaEl.appendChild(fragment);
    _atualizarResumoEBotaoConfirmarUI();
}

function _popularBadgesFeedbackItem(containerEl, item) {
    containerEl.textContent = '';
    const msg = item.motivoConflitoNome || item.motivoAvisoBase;
    if (!msg) return;

    const badge = document.createElement('span');
    let tipoClasse = 'warn';
    if (item.statusEfetivo === 'nao-encontrado') tipoClasse = 'error';
    else if (item.statusEfetivo === 'sem-alteracao') tipoClasse = 'neutral';

    badge.className = `acervo-rename-status-badge ${tipoClasse}`;
    badge.textContent = msg;
    containerEl.appendChild(badge);
}

function _sincronizarLinhasExistentesSemReflow() {
    const listaEl = document.getElementById('lista-preview-renomeacoes');
    if (!listaEl) return;

    const rows = listaEl.querySelectorAll('.acervo-rename-row');
    rows.forEach(row => {
        const idx = parseInt(row.dataset.idx, 10);
        const item = _itensRenomeacaoIA[idx];
        if (!item) return;

        row.className = `acervo-rename-row status-${item.statusEfetivo}`;

        const chk = row.querySelector('.chk-rename-ia');
        if (chk) {
            const desabilitado = (item.statusEfetivo === 'nao-encontrado' || item.statusEfetivo === 'sem-alteracao');
            chk.disabled = desabilitado;
            chk.checked = !desabilitado && Boolean(item.selecionado);
        }

        const input = row.querySelector('.acervo-rename-new-input');
        if (input) {
            input.classList.toggle('has-conflict', Boolean(item.motivoConflitoNome));
        }

        const slot = row.querySelector('.acervo-rename-feedback-slot');
        if (slot) {
            _popularBadgesFeedbackItem(slot, item);
        }
    });

    _atualizarResumoEBotaoConfirmarUI();
}

window.atualizarResumoHomologacaoLoteUI = function() {
    _atualizarResumoEBotaoConfirmarUI();
};

function _atualizarResumoEBotaoConfirmarUI() {
    const resumoEl = document.getElementById('resumo-preview-renomeacoes');
    const btnConfirmar = document.getElementById('btn-confirmar-renomeacoes-lote');
    const boxPreview = document.getElementById('box-preview-renomeacoes');
    const boxHomologar = document.getElementById('box-homologar-lote-aprovados');
    const chkHomologar = document.getElementById('chk-homologar-aprovados-lote');
    const tituloHomologar = document.getElementById('titulo-homologar-aprovados');

    let qtdPronto = 0, qtdConferir = 0, qtdInalterado = 0, qtdNaoEncontrado = 0, qtdRenomeacoesSelecionadas = 0;

    _itensRenomeacaoIA.forEach(item => {
        if (item.statusEfetivo === 'pronto') qtdPronto++;
        else if (item.statusEfetivo === 'conferir') qtdConferir++;
        else if (item.statusEfetivo === 'sem-alteracao') qtdInalterado++;
        else if (item.statusEfetivo === 'nao-encontrado') qtdNaoEncontrado++;

        const nomeValido = item.novoNome && item.novoNome.trim() !== '';
        const mudou = _normalizarTituloComparacao(item.novoNome) !== _normalizarTituloComparacao(item.nomeOriginalBanco);
        if (item.modeloId && item.selecionado && nomeValido && mudou) {
            qtdRenomeacoesSelecionadas++;
        }
    });

    if (boxPreview) {
        boxPreview.style.display = _itensRenomeacaoIA.length > 0 ? 'flex' : 'none';
    }

    const qtdAprovadosExplicitos = _blocoDelimitadoCompleto ? _itensHomologacaoExplicitaIA.length : 0;
    if (boxHomologar && tituloHomologar) {
        if (qtdAprovadosExplicitos > 0) {
            boxHomologar.style.display = 'block';
            const sufixoLote = _loteVerificadoComSucesso
                ? `deste lote (${_loteIdDetectadoNoTexto})`
                : '(lote não verificado — confira a lista abaixo e marque manualmente se confirmar)';
            tituloHomologar.textContent = `✔ Homologar também ${qtdAprovadosExplicitos} modelo(s) aprovados explicitamente pela IA (<OK>) ${sufixoLote}`;
        } else {
            boxHomologar.style.display = 'none';
        }
    }

    const qtdHomologarAtiva = (qtdAprovadosExplicitos > 0 && chkHomologar && chkHomologar.checked)
        ? qtdAprovadosExplicitos
        : 0;

    if (resumoEl) {
        resumoEl.textContent = '';
        const criarPill = (texto, classe) => {
            const pill = document.createElement('span');
            pill.className = `acervo-stat-pill ${classe}`;
            pill.textContent = texto;
            return pill;
        };
        resumoEl.appendChild(criarPill(`✔ ${qtdPronto} pronto(s)`, 'pronto'));
        if (qtdConferir > 0) resumoEl.appendChild(criarPill(`⚠️ ${qtdConferir} p/ conferir`, 'conferir'));
        if (qtdInalterado > 0) resumoEl.appendChild(criarPill(`＝ ${qtdInalterado} sem alteração`, 'inalterado'));
        if (qtdNaoEncontrado > 0) resumoEl.appendChild(criarPill(`✕ ${qtdNaoEncontrado} não encontrado(s)`, 'erro'));
    }

    if (btnConfirmar) {
        const totalOperacoes = qtdRenomeacoesSelecionadas + qtdHomologarAtiva;
        btnConfirmar.disabled = (totalOperacoes === 0);

        if (qtdRenomeacoesSelecionadas > 0 && qtdHomologarAtiva > 0) {
            btnConfirmar.textContent = `✔ Renomear ${qtdRenomeacoesSelecionadas} e Homologar +${qtdHomologarAtiva} Aprovado(s)`;
        } else if (qtdRenomeacoesSelecionadas > 0) {
            btnConfirmar.textContent = `✔ Aplicar ${qtdRenomeacoesSelecionadas} Renomeação(ões)`;
        } else if (qtdHomologarAtiva > 0) {
            btnConfirmar.textContent = `✔ Homologar ${qtdHomologarAtiva} Modelo(s) Aprovado(s)`;
        } else {
            btnConfirmar.textContent = '✔ Aplicar Atualizações Selecionadas';
        }
    }
}

function _configurarEventDelegationImportacao() {
    if (_delegacaoImportacaoAtiva) return;
    const listaEl = document.getElementById('lista-preview-renomeacoes');
    if (!listaEl) return;

    listaEl.addEventListener('change', (e) => {
        const chk = e.target.closest('.chk-rename-ia');
        if (!chk) return;
        const idx = parseInt(chk.dataset.idx, 10);
        const item = _itensRenomeacaoIA[idx];
        if (!item) return;

        item.selecionado = chk.checked;
        _edicoesManuaisRenomeacao.set(item.chaveEstavel, {
            selecionado: item.selecionado,
            novoNome: item.novoNome
        });

        _recalcularConflitosDeNomes();
        _sincronizarLinhasExistentesSemReflow();
    });

    listaEl.addEventListener('input', (e) => {
        const input = e.target.closest('.acervo-rename-new-input');
        if (!input) return;
        const idx = parseInt(input.dataset.idx, 10);
        const item = _itensRenomeacaoIA[idx];
        if (!item) return;

        item.novoNome = input.value;
        _edicoesManuaisRenomeacao.set(item.chaveEstavel, {
            selecionado: item.selecionado,
            novoNome: item.novoNome
        });

        _recalcularConflitosDeNomes();
        _sincronizarLinhasExistentesSemReflow();
    });

    _delegacaoImportacaoAtiva = true;
}

window.alternarSelecaoTodasRenomeacoes = function(marcarProntos) {
    _itensRenomeacaoIA.forEach(item => {
        if (!item.modeloId || item.statusEfetivo === 'nao-encontrado' || item.statusEfetivo === 'sem-alteracao') {
            item.selecionado = false;
            return;
        }
        item.selecionado = marcarProntos ? (item.statusEfetivo === 'pronto') : false;
        _edicoesManuaisRenomeacao.set(item.chaveEstavel, {
            selecionado: item.selecionado,
            novoNome: item.novoNome
        });
    });

    _recalcularConflitosDeNomes();
    _sincronizarLinhasExistentesSemReflow();
};

window.executarRenomeacaoEmLoteIA = async function() {
    const renomeacoesSelecionadas = _itensRenomeacaoIA.filter(item => {
        const nomeValido = item.novoNome && item.novoNome.trim() !== '';
        const mudou = _normalizarTituloComparacao(item.novoNome) !== _normalizarTituloComparacao(item.nomeOriginalBanco);
        return Boolean(item.modeloId && item.selecionado && nomeValido && mudou);
    });

    const chkHomologar = document.getElementById('chk-homologar-aprovados-lote');
    const homologarAprovados = Boolean(_blocoDelimitadoCompleto && chkHomologar && chkHomologar.checked);
    const modelosApenasHomologar = homologarAprovados ? _itensHomologacaoExplicitaIA : [];

    if (renomeacoesSelecionadas.length === 0 && modelosApenasHomologar.length === 0) return;

    const btnConfirmar = document.getElementById('btn-confirmar-renomeacoes-lote');
    const textoOriginalBtn = btnConfirmar ? btnConfirmar.textContent : '';
    if (btnConfirmar) {
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = '⌛ Gravando lote na nuvem...';
    }

    try {
        const loteIdRef = _loteIdDetectadoNoTexto || 'ia-manual';
        const operacoesFirestore = [];
        const snapshotReversao = [];

        renomeacoesSelecionadas.forEach(item => {
            const modOriginal = item.modeloRef || _modelosBaseImportacao.find(m => m.id === item.modeloId);
            const qtdNos = (modOriginal && Array.isArray(modOriginal.nos)) ? modOriginal.nos.length : 0;
            const novoNomeLimpo = item.novoNome.trim();

            operacoesFirestore.push({
                id: item.modeloId,
                novoNome: novoNomeLimpo,
                auditoriaIA: AcervoManager.criarAssinaturaAuditoria(novoNomeLimpo, qtdNos, loteIdRef)
            });

            snapshotReversao.push({
                id: item.modeloId,
                nomeAnterior: item.nomeOriginalBanco,
                nomeAplicado: novoNomeLimpo,
                auditoriaAnterior: (modOriginal && modOriginal.auditoriaIA) ? { ...modOriginal.auditoriaIA } : null,
                foiRenomeado: true
            });
        });

        modelosApenasHomologar.forEach(mod => {
            const qtdNos = Array.isArray(mod.nos) ? mod.nos.length : 0;
            operacoesFirestore.push({
                id: mod.id,
                novoNome: null,
                auditoriaIA: AcervoManager.criarAssinaturaAuditoria(mod.nome, qtdNos, loteIdRef)
            });

            snapshotReversao.push({
                id: mod.id,
                nomeAnterior: mod.nome,
                nomeAplicado: mod.nome,
                auditoriaAnterior: mod.auditoriaIA ? { ...mod.auditoriaIA } : null,
                foiRenomeado: false
            });
        });

        const totalGravados = await AcervoManager.renomearModelosEmLote(operacoesFirestore);
        _ultimoLoteReversaoIA = snapshotReversao;

        _modelosBaseImportacao = await AcervoManager.carregarModelos(true);
        _atualizarBarraReversaoUI();

        exibirToast(`${totalGravados} modelo(s) sincronizado(s) com sucesso!`, 'sucesso');
        await window.analisarTextoRenomeacoesIA();
    } catch (e) {
        console.error('[AcervoController] Falha ao aplicar lote:', e);
        exibirToast(e.message || 'Erro ao gravar alterações na nuvem.', 'erro');
        if (btnConfirmar) {
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = textoOriginalBtn;
        }
    }
};

function _atualizarBarraReversaoUI() {
    const barra = document.getElementById('barra-reversao-renomeacoes');
    const texto = document.getElementById('texto-barra-reversao');
    const btnBaixarTxt = document.getElementById('btn-baixar-reversao-lote');
    if (!barra || !texto) return;

    if (_ultimoLoteReversaoIA && _ultimoLoteReversaoIA.length > 0) {
        const qtdRenomeados = _ultimoLoteReversaoIA.filter(i => i.foiRenomeado).length;
        const qtdHomologados = _ultimoLoteReversaoIA.length - qtdRenomeados;

        texto.textContent = `✔ Último lote aplicado (${qtdRenomeados} renomeado(s), ${qtdHomologados} homologado(s)). Deseja desfazer?`;
        if (btnBaixarTxt) {
            btnBaixarTxt.style.display = qtdRenomeados > 0 ? 'inline-block' : 'none';
        }
        barra.style.display = 'flex';
    } else {
        barra.style.display = 'none';
    }
}

window.baixarArquivoReversaoUltimoLote = function() {
    if (!_ultimoLoteReversaoIA || _ultimoLoteReversaoIA.length === 0) return;

    const apenasRenomeados = _ultimoLoteReversaoIA.filter(item => item.foiRenomeado);
    if (apenasRenomeados.length === 0) {
        return exibirToast('O último lote teve apenas homologações (sem troca de nomes). Use "Desfazer Último Lote".', 'aviso');
    }

    let conteudo = '<<<JURIS_RENOMEAR>>>\n';
    apenasRenomeados.forEach(item => {
        conteudo += `${item.id} ||| ${item.nomeAplicado} ||| ${item.nomeAnterior}\n`;
    });
    conteudo += '<<<FIM_JURIS_RENOMEAR>>>\n';

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    _downloadTextoComoArquivo(`JurisNotes_Reversao_Nomes_${stamp}.txt`, conteudo);
    exibirToast('Arquivo de reversão baixado.', 'sucesso');
};

window.desfazerUltimoLoteRenomeacao = async function() {
    if (!_ultimoLoteReversaoIA || _ultimoLoteReversaoIA.length === 0) return;
    if (!confirm(`Restaurar os nomes e o status de auditoria anteriores de ${_ultimoLoteReversaoIA.length} modelo(s)?`)) return;

    try {
        const operacoesReversao = _ultimoLoteReversaoIA.map(item => ({
            id: item.id,
            novoNome: item.foiRenomeado ? item.nomeAnterior : null,
            auditoriaIA: item.auditoriaAnterior
        }));

        const restaurados = await AcervoManager.renomearModelosEmLote(operacoesReversao);
        _ultimoLoteReversaoIA = null;
        _atualizarBarraReversaoUI();

        _modelosBaseImportacao = await AcervoManager.carregarModelos(true);
        await window.analisarTextoRenomeacoesIA();

        exibirToast(`${restaurados} modelo(s) restaurado(s) ao estado original!`, 'sucesso');
    } catch (e) {
        exibirToast(e.message || 'Erro ao desfazer alterações.', 'erro');
    }
};