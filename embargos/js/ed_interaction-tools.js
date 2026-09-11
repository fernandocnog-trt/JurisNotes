/* ================================================
   interaction-tools.js  —  v1.0
   Ferramentas interativas de captura e classificação.

   Responsabilidades:
   - Wizard de Recorte de Imagem (state-machine de 3 estados)
   - Popup de Classificação de Texto
   - Event Listeners do Overlay de Recorte

   Dependências externas (definidas em app.js, carregado após):
   - topicos[], currentPage           → leitura/escrita de estado global
   - salvarAnotacao(), renderizarTopicos(), exibirToast()  → chamadas de serviço
   ================================================ */

/* ================================================
   REFERÊNCIA AO OVERLAY (DOM já disponível: script no fim do <body>)
   ================================================ */
const overlay = document.getElementById('crop-overlay');

/* ================================================
   ESTADO DO WIZARD DE RECORTE E EXTRATOR
   ================================================ */
let modoRecorteAtivo         = false;
let modoExtratorAtivo        = false;
let extratorTempState        = null;
let startX, startY;
let cropBox                  = null;
let _wizardTopicoSelecionado = null;  // ID do tópico confirmado no Passo 1
let _wizardImagemCapturada   = null;  // Data URL base64 do recorte confirmado
let _ultimoTopicoUsadoId     = null;  // Memória inteligente: pré-seleciona na próxima abertura

/* ================================================
   ESTADO DO POPUP DE CLASSIFICAÇÃO
   ================================================ */
let pendingTipo     = null;   // Tipo da extração pendente: 'texto' | 'imagem'
let pendingConteudo = null;   // Conteúdo bruto da extração pendente

/* ================================================
   CONTROLADOR SINGLETON DO DROPDOWN (PREVINE MEMORY LEAKS E CLIPPING)
   ================================================ */
const DropdownManager = (function() {
    let _activeTrigger = null;
    let _activePortal = null;
    let _eventosGlobaisRegistrados = false;

    function fecharAtivo() {
        if (_activePortal) {
            _activePortal.remove();
            _activePortal = null;
        }
        if (_activeTrigger) {
            _activeTrigger.setAttribute('aria-expanded', 'false');
            _activeTrigger.focus();
            _activeTrigger = null;
        }
    }

    function registrarEventosGerais() {
        if (_eventosGlobaisRegistrados) return;
        
        document.addEventListener('click', (e) => {
            if (_activePortal && !_activePortal.contains(e.target) && !_activeTrigger.contains(e.target)) {
                fecharAtivo();
            }
        });

        window.addEventListener('scroll', (e) => {
            if (_activePortal && (e.target === _activePortal || _activePortal.contains(e.target))) {
                return;
            }
            fecharAtivo();
        }, { passive: true, capture: true });
        
        window.addEventListener('resize', fecharAtivo, { passive: true });
        
        _eventosGlobaisRegistrados = true;
    }

    function abrirPortal(triggerEl, topicosArray, selectNativo, onSelectCallback) {
        fecharAtivo(); 
        
        _activeTrigger = triggerEl;
        _activeTrigger.setAttribute('aria-expanded', 'true');

        const rect = triggerEl.getBoundingClientRect();
        
        _activePortal = document.createElement('div');
        _activePortal.className = 'jcs-options-portal';
        _activePortal.setAttribute('role', 'listbox');
        
        const desiredWidth = Math.max(rect.width, 380);
        _activePortal.style.width = `${desiredWidth}px`;

        if (rect.left + desiredWidth > window.innerWidth) {
            _activePortal.style.left = `${window.innerWidth - desiredWidth - 16}px`;
        } else {
            _activePortal.style.left = `${rect.left}px`;
        }
        
        _activePortal.style.top = `${rect.bottom + 4}px`;

        let focusedIndex = -1;
        const optionsNodes = [];

        topicosArray.forEach((t, index) => {
            const opt = document.createElement('div');
            opt.className = 'jcs-option';
            opt.setAttribute('role', 'option');
            opt.innerHTML = `<div class="jcs-color-dot" style="background-color: ${t.cor};"></div> <span>${t.nome}</span>`;
            
            const selecionarOpcao = () => {
                selectNativo.value = t.id;
                triggerEl.querySelector('.jcs-trigger-content').innerHTML = opt.innerHTML;
                
                selectNativo.dispatchEvent(new Event('change'));
                if (onSelectCallback) onSelectCallback(t);
                
                fecharAtivo();
            };

            opt.addEventListener('click', selecionarOpcao);
            opt.addEventListener('mousemove', () => atualizarFoco(index));

            optionsNodes.push({ node: opt, selectFn: selecionarOpcao });
            _activePortal.appendChild(opt);
        });

        function atualizarFoco(newIndex) {
            if (focusedIndex >= 0) optionsNodes[focusedIndex].node.classList.remove('is-focused');
            focusedIndex = newIndex;
            if (focusedIndex >= 0) {
                optionsNodes[focusedIndex].node.classList.add('is-focused');
                optionsNodes[focusedIndex].node.scrollIntoView({ block: 'nearest' });
            }
        }

        _activePortal.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                atualizarFoco((focusedIndex + 1) % optionsNodes.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                atualizarFoco((focusedIndex - 1 + optionsNodes.length) % optionsNodes.length);
            } else if (e.key === 'Enter' && focusedIndex >= 0) {
                e.preventDefault();
                optionsNodes[focusedIndex].selectFn();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                fecharAtivo();
            }
        });

        document.body.appendChild(_activePortal); 
        _activePortal.setAttribute('tabindex', '-1');
        _activePortal.focus(); 
    }

    function renderizar(selectId, topicosArray, preSelecionadoId = null, onSelectCallback = null) {
        registrarEventosGerais();
        
        const selectNativo = document.getElementById(selectId);
        if (!selectNativo) return;

        const topicosOrdenados = [...topicosArray].reverse();

        selectNativo.innerHTML = '<option value="">Selecione o Tópico...</option>';
        topicosOrdenados.forEach(t => selectNativo.appendChild(new Option(t.nome, t.id)));
        if (preSelecionadoId) selectNativo.value = preSelecionadoId;
        
        selectNativo.classList.add('sr-only');

        const wrapperAntigo = selectNativo.nextElementSibling;
        if (wrapperAntigo && wrapperAntigo.classList.contains('juris-custom-select')) {
            wrapperAntigo.remove();
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'juris-custom-select';
        
        const topicoInicial = topicosOrdenados.find(t => t.id === preSelecionadoId);
        const triggerHtml = topicoInicial 
            ? `<div class="jcs-color-dot" style="background-color: ${topicoInicial.cor};"></div> <span>${topicoInicial.nome}</span>`
            : `<span class="jcs-placeholder-text">Selecione o Tópico...</span>`;

        wrapper.innerHTML = `
            <div class="jcs-trigger" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false">
                <div style="display:flex; align-items:center; gap:10px;" class="jcs-trigger-content">
                    ${triggerHtml}
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" style="width:16px; height:16px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
        `;

        const triggerBtn = wrapper.querySelector('.jcs-trigger');

        const abrir = (e) => {
            e.preventDefault();
            e.stopPropagation();
            abrirPortal(triggerBtn, topicosOrdenados, selectNativo, onSelectCallback);
        };

        triggerBtn.addEventListener('click', abrir);
        triggerBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') abrir(e);
        });

        selectNativo.parentNode.insertBefore(wrapper, selectNativo.nextSibling);
    }

    return { renderizar };
})();

window.DropdownManager = DropdownManager;

window.toggleModoFoco = function(ativar) {
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer) {
        if (ativar) pdfContainer.classList.add('pdf-foco-ativo');
        else pdfContainer.classList.remove('pdf-foco-ativo');
    }
};

// --- CONFIGURAÇÃO CENTRAL DE DOCUMENTOS ---
const DOC_CONFIG = [
    // --- FASE 1: O Escopo ---
    { label: 'Embargos de Declaração',    polo: 'DUAL',         tipo: 'dual',   fase: 1 },
    { label: 'Contraminuta aos EDs',      polo: 'DUAL',         tipo: 'dual',   fase: 1 },
    { label: 'Embargos à Execução',       polo: 'Parte Executada', tipo: 'auto', fase: 1, isExecucao: true },
    { label: 'Impugnação aos Cálculos',   polo: 'Parte Exequente', tipo: 'auto', fase: 1, isExecucao: true },
    
    // --- FASE 2: Provocação Original ---
    { label: 'Recurso Ordinário',         polo: 'DUAL',         tipo: 'dual',   fase: 2 },
    { label: 'Recurso Adesivo',           polo: 'DUAL',         tipo: 'dual',   fase: 2 },
    { label: 'Contrarrazões ao RO',       polo: 'DUAL',         tipo: 'dual',   fase: 2 },
    { label: 'Petição Inicial',           polo: 'Parte Autora', tipo: 'auto',   fase: 2 },
    { label: 'Contestação',               polo: 'Parte Ré',     tipo: 'auto',   fase: 2 },
    { label: 'Impugnação à Contestação',  polo: 'Parte Autora', tipo: 'auto',   fase: 2 },
    { label: 'Cálculos de Liquidação',    polo: 'DUAL',         tipo: 'dual',   fase: 2, isExecucao: true },
    { label: 'Audiência de Instrução',    polo: 'DUAL',         tipo: 'dual',   fase: 2 },

    // --- FASE 3: A Decisão ---
    { label: 'Acórdão Embargado',         polo: 'Juízo',        tipo: 'auto',   fase: 3 },
    { label: 'Sentença Embargada',        polo: 'Juízo',        tipo: 'auto',   fase: 3 },
    { label: 'Sentença de Liquidação',    polo: 'Juízo',        tipo: 'auto',   fase: 3, isExecucao: true },
    
    // --- FASE 4: Validação / Provas (Expansão ED) ---
    { label: 'Guia de Recolhimento / Comprovante', polo: 'DUAL', tipo: 'dual', fase: 4 },
    { label: 'Petição Original (Erro Material)',   polo: 'DUAL', tipo: 'dual', fase: 4 },
    { label: 'Súmula / Jurisprudência Vinculante', polo: 'Tribunal', tipo: 'auto', fase: 4 },
    // Novas tipologias (Arquitetura One-Click com granularidade limpa para IA):
    { label: 'Manifestação (Parte Autora)',        polo: 'Parte Autora', tipo: 'auto', fase: 4 },
    { label: 'Manifestação (Parte Ré)',            polo: 'Parte Ré',     tipo: 'auto', fase: 4 },
    { label: 'Manifestação (Exequente)',           polo: 'Parte Exequente', tipo: 'auto', fase: 4 },
    { label: 'Manifestação (Executada)',           polo: 'Parte Executada', tipo: 'auto', fase: 4 },
    { label: 'Atos da Secretaria / Certidões',     polo: 'Auxiliar da Justiça', tipo: 'auto', fase: 4 },
    { label: 'Decisão / Despacho (Andamento)',     polo: 'Juízo', tipo: 'auto', fase: 4 }
];

let _docSelecionado = null;
let _isWizardContext = false;
let _pendingTargetIndex = null;
let _wizardVicioSelecionado = null; // Variável global de transporte para o vício

function renderizarFasesModais(context) {
    const tabsContainer = document.getElementById(`${context}-phase-tabs`);
    const listContainer = document.getElementById(`lista-docs-${context}`);
    if (!tabsContainer || !listContainer) return;
    
    const fases = [
        { id: 1, nome: '1. Escopo' },
        { id: 2, nome: '2. Provocação' },
        { id: 3, nome: '3. Decisão' },
        { id: 4, nome: '4. Validação' }
    ];

    tabsContainer.innerHTML = '';
    fases.forEach(f => {
        const btn = document.createElement('button');
        btn.className = `phase-tab-btn`;
        btn.textContent = f.nome;
        btn.onclick = (e) => {
            e.stopPropagation();
            Array.from(tabsContainer.children).forEach(b => b.className = 'phase-tab-btn');
            btn.classList.add(`active-f${f.id}`);
            
            listContainer.innerHTML = '';
            DOC_CONFIG.filter(doc => doc.fase === f.id).forEach(doc => {
                const docBtn = document.createElement('button');
                docBtn.className = `doc-btn ${doc.tipo}`;
                docBtn.textContent = doc.label;
                docBtn.onclick = (e) => { e.stopPropagation(); selecionarDocumento(doc.label, doc.polo || 'DUAL', context); };
                listContainer.appendChild(docBtn);
            });
        };
        tabsContainer.appendChild(btn);
    });
}

function toggleAgruparPopup() {
    const isAgrupar = document.querySelector('input[name="modo_agrupar_popup"]:checked').value === 'agrupar';
    document.getElementById('input-ideia-popup').style.display = isAgrupar ? 'block' : 'none';
}

function toggleAgruparWizard() {
    const isAgrupar = document.querySelector('input[name="modo_agrupar_wizard"]:checked').value === 'agrupar';
    document.getElementById('input-ideia-wizard').style.display = isAgrupar ? 'block' : 'none';
}

function processarAgrupamento(topicoId, inputId) {
    const isWizard = inputId.includes('wizard');
    const radioName = isWizard ? 'modo_agrupar_wizard' : 'modo_agrupar_popup';
    
    if (document.querySelector(`input[name="${radioName}"]:checked`).value === 'agrupar') {
        const topico = topicos.find(t => t.id === topicoId);
        const numero = parseInt(document.getElementById(inputId).value, 10);
        
        if (isNaN(numero) || numero < 1 || numero > topico.anotacoes.length) {
            exibirToast(`Número inválido. O tópico tem ${topico.anotacoes.length} ideia(s).`, 'erro');
            return false;
        }
        return numero - 1; // Retorna índice base 0
    }
    return null;
}

function selecionarDocumento(docLabel, polo, context) {
    const topicoId = context === 'popup' ? document.getElementById('seletor-topico').value : _wizardTopicoSelecionado;
    if (!topicoId) { exibirToast('Selecione o tópico de destino primeiro.', 'aviso'); return; }

    const inputId = context === 'popup' ? 'input-ideia-popup' : 'input-ideia-wizard';
    const targetIndex = processarAgrupamento(topicoId, inputId);
    if (targetIndex === false) return; 

    _pendingTargetIndex = targetIndex;
    
    if (polo === 'DUAL') {
        _docSelecionado = docLabel;
        _isWizardContext = (context === 'wizard');
        
        const conf = DOC_CONFIG.find(d => d.label === docLabel);
        const isExecucao = conf && conf.isExecucao;

        const targetDocText = context === 'popup' ? 'popup-doc-selecionado' : 'wizard-doc-selecionado';
        const targetContainer = context === 'popup' ? 'popup-polo-buttons-container' : 'wizard-polo-buttons-container';
        
        document.getElementById(targetDocText).innerText = docLabel;
        
        let htmlBotoes = '';

        if (isExecucao) {
            htmlBotoes += `<button class="chip-btn chip-exequente" onclick="confirmarPolo('Parte Exequente', event)">✔ Parte Exequente</button>`;
            htmlBotoes += `<button class="chip-btn chip-executada" onclick="confirmarPolo('Parte Executada', event)">✔ Parte Executada</button>`;
            htmlBotoes += `<button class="chip-btn chip-juizo" onclick="confirmarPolo('Juízo / Tribunal', event)">🏛️ Juízo / Tribunal</button>`;
            htmlBotoes += `<button class="chip-btn chip-auxiliar" onclick="confirmarPolo('Auxiliar da Justiça', event)">⚖️ Auxiliar da Justiça</button>`;
        } else {
            htmlBotoes += `<button class="chip-btn chip-autora" onclick="confirmarPolo('Parte Autora', event)">✔ Parte Autora</button>`;
            htmlBotoes += `<button class="chip-btn chip-re" onclick="confirmarPolo('Parte Ré', event)">✔ Parte Ré</button>`;
        }
        
        if (context === 'popup') {
            htmlBotoes += `<button class="chip-btn chip-cancelar" onclick="voltarParaDocumentos('popup', event)">← Voltar</button>`;
        } else {
            htmlBotoes += `<div class="wizard-actions" style="margin-top: 0;"><button class="chip-btn chip-cancelar" onclick="voltarParaDocumentos('wizard', event)">← Voltar</button></div>`;
        }

        document.getElementById(targetContainer).innerHTML = htmlBotoes;

        document.getElementById(`${context}-step-doc`).style.display = 'none';
        document.getElementById(`${context}-step-polo`).style.display = 'block';
    } else {
        executarSalvamento(docLabel, polo, topicoId, _pendingTargetIndex, context);
    }
}

function confirmarPolo(polo, event) {
    if(event) event.stopPropagation();
    const context = _isWizardContext ? 'wizard' : 'popup';
    const topicoId = context === 'popup' ? document.getElementById('seletor-topico').value : _wizardTopicoSelecionado;
    executarSalvamento(_docSelecionado, polo, topicoId, _pendingTargetIndex, context);
}

function voltarParaDocumentos(context, event) {
    if(event) event.stopPropagation();
    document.getElementById(`${context}-step-polo`).style.display = 'none';
    document.getElementById(`${context}-step-doc`).style.display = 'block';
    _docSelecionado = null;
}

function executarSalvamento(docLabel, polo, topicoId, targetIndex, context) {
    const conf = DOC_CONFIG.find(d => d.label === docLabel);
    const faseNova = conf ? conf.fase : 4;

    if (faseNova === 4 && targetIndex === null) {
        const topicoAlvo = topicos.find(t => t.id === topicoId);
        if (topicoAlvo) {
            const qtdFase4 = topicoAlvo.anotacoes.filter(a => {
                const aConf = DOC_CONFIG.find(d => d.label === a.documento);
                return aConf && aConf.fase === 4;
            }).length;
            
            if (qtdFase4 >= 1) { 
                exibirToast("⚠️ Guardrail ED: Extrações extensas configuram risco de rejulgamento fático. Limite-se a falhas estruturais.", "aviso");
            }
        }
    }

    if (context === 'popup') {
        const comentario = document.getElementById('comentario-input').value.trim();
        salvarAnotacao(pendingTipo, pendingConteudo, docLabel, polo, topicoId, comentario, targetIndex, null, null);
        fecharPopupClassificacao();
    } else {
        _ultimoTopicoUsadoId = topicoId;
        const comentario = document.getElementById('crop-comment-input').value.trim();
        salvarAnotacao('imagem', _wizardImagemCapturada, docLabel, polo, topicoId, comentario, targetIndex, null, null);
        fecharTudoWizard();
    }
}

/* ================================================
   WIZARD DE RECORTE DE IMAGEM
   State-machine de 3 estados:
   IDLE → PASSO_1 (seleção de tópico) →
   RECORTANDO (overlay ativo) → PASSO_2 (confirmação)
   ================================================ */

/**
 * PASSO 0 — Ponto de entrada.
 * Abre o Passo 1 do wizard (seleção de tópico).
 * Bloqueia a interface com o backdrop.
 */
function iniciarRecorteWizard() {
    window.toggleModoFoco(true);
    if (topicos.length === 0) {
        exibirToast('Crie pelo menos um Tópico Recursal antes de realizar recortes.', 'aviso');
        return;
    }

    DropdownManager.renderizar('crop-topic-select', topicos, _ultimoTopicoUsadoId);

    document.getElementById('wizard-backdrop').style.display  = 'block';
    document.getElementById('crop-wizard-step1').style.display = 'flex';
}

/**
 * PASSO 1 → RECORTANDO.
 * Valida o tópico selecionado, fecha o Passo 1 e ativa o overlay de recorte.
 */
function avancarParaRecorte() {
    const topicoId = document.getElementById('crop-topic-select').value;
    if (!topicoId) {
        exibirToast('Selecione um tópico para continuar.', 'aviso');
        return;
    }

    _wizardTopicoSelecionado = topicoId;
    document.getElementById('crop-wizard-step1').style.display = 'none';
    document.getElementById('wizard-backdrop').style.display   = 'none';

    // NOVO: Remove o desfoque do documento para garantir precisão no recorte
    window.toggleModoFoco(false);

    modoRecorteAtivo = true;
    const r = document.getElementById('pdf-container').getBoundingClientRect();
    overlay.style.position = 'fixed';
    overlay.style.left     = r.left   + 'px';
    overlay.style.top      = r.top    + 'px';
    overlay.style.width    = r.width  + 'px';
    overlay.style.height   = r.height + 'px';
    overlay.style.display  = 'block';

    // CORREÇÃO ARQUITETURAL: Desativa a camada de texto E a camada de links (annotationLayer).
    // A highlightLayer NÃO é alterada aqui para respeitar seu estado CSS base.
    document.querySelectorAll('.textLayer, .annotationLayer').forEach(l => l.style.pointerEvents = 'none');
    
    document.getElementById('btn-ferramenta-recorte').classList.add('ativo');
    exibirToast('Tópico confirmado. Arraste o mouse sobre o documento para recortar.', 'sucesso');
}

/**
 * RECORTANDO → IDLE.
 * Esconde o overlay e restaura os event listeners do texto e dos links.
 */
function desativarOverlayRecorte() {
    modoRecorteAtivo = false;
    overlay.style.display = 'none';
    document.getElementById('btn-ferramenta-recorte').classList.remove('ativo');
    
    // RESTAURAÇÃO: Devolve a interatividade APENAS para as camadas que foram bloqueadas.
    document.querySelectorAll('.textLayer, .annotationLayer').forEach(l => l.style.pointerEvents = 'auto');
}

/**
 * RECORTANDO → PASSO_2.
 * Desativa o overlay e exibe o Passo 2 com a pré-visualização da imagem.
 */
function abrirConfirmacaoRecorteWizard() {
    desativarOverlayRecorte();
    
    // NOVO: Reativa o desfoque para centralizar a atenção cognitiva no formulário
    window.toggleModoFoco(true);

    document.getElementById('crop-preview-img').src = _wizardImagemCapturada;
    document.getElementById('crop-comment-input').value = '';
    
    // NOVO: Resetar modal e popular seletor com o tópico escolhido no Passo 1
    document.querySelector('input[name="modo_agrupar_wizard"][value="nova"]').checked = true;
    toggleAgruparWizard();
    
    renderizarFasesModais('wizard');
    const tabsWizard = document.getElementById('wizard-phase-tabs');
    if(tabsWizard && tabsWizard.firstElementChild) tabsWizard.firstElementChild.click();

    const topicoObj = topicos.find(t => t.id === _wizardTopicoSelecionado);
    const wizardHeader = document.getElementById('wizard-topic-color-feedback');
    if(topicoObj && wizardHeader) {
        wizardHeader.style.backgroundColor = topicoObj.cor;
        wizardHeader.style.height = '6px';
    }

    document.getElementById('wizard-backdrop').style.display = 'block';
    document.getElementById('crop-wizard-step2').style.display = 'flex';
}

/**
 * PASSO_2 → IDLE.
 * Salva a anotação com o polo selecionado e encerra o wizard.
 */
function finalizarRecorteWizard(polo) {
    const comentario = document.getElementById('crop-comment-input').value.trim();
    _ultimoTopicoUsadoId = _wizardTopicoSelecionado;
    
    let targetIndex = null;
    if (document.querySelector('input[name="modo_agrupar_wizard"]:checked').value === 'agrupar') {
        targetIndex = document.getElementById('seletor-ideia-wizard').value;
    }

    salvarAnotacao('imagem', _wizardImagemCapturada, polo, _wizardTopicoSelecionado, comentario, targetIndex);
    fecharTudoWizard();
}

/**
 * PASSO_2 → RECORTANDO.
 * Volta ao overlay sem retornar ao Passo 1: o tópico já foi escolhido.
 */
function refazerRecorteArea() {
    document.getElementById('crop-wizard-step2').style.display = 'none';
    document.getElementById('wizard-backdrop').style.display   = 'none';
    avancarParaRecorte();
}

/**
 * QUALQUER ESTADO → IDLE.
 * Cancela o wizard por completo, fechando todos os painéis e limpando o estado.
 */
function cancelarRecorteWizard() {
    fecharTudoWizard();
    desativarOverlayRecorte();
}

/** Utilitário interno: fecha os painéis visuais e zera as variáveis de estado. */
function fecharTudoWizard() {
    window.toggleModoFoco(false);
    document.getElementById('crop-wizard-step1').style.display = 'none';
    document.getElementById('crop-wizard-step2').style.display = 'none';
    document.getElementById('wizard-backdrop').style.display   = 'none';

    _wizardTopicoSelecionado = null;
    _wizardImagemCapturada   = null;
    
    // NOVO: Prevenção de State Leakage
    if (typeof _tempHighlightState !== 'undefined') {
        _tempHighlightState.rects = null;
        _tempHighlightState.paginaFisica = null;
    }
}

/* ================================================
   POPUP DE CLASSIFICAÇÃO DE TEXTO
   ================================================ */

function fecharPopupClassificacao() {
    window.toggleModoFoco(false);
    const popup = document.getElementById('classification-popup');
    popup.style.display = 'none';

    document.getElementById('popup-step-polo').style.display = 'none';
    document.getElementById('popup-step-doc').style.display = 'block';
    
    // LIMPEZA DE ESTADO DE COMPONENTES
    document.getElementById('input-ideia-popup').value = '';

    const txtArea = document.getElementById('comentario-input');
    if (txtArea) {
        txtArea.style.display = 'none';
        txtArea.value = '';
    }
    pendingTipo = null;
    pendingConteudo = null;
    
    // NOVO: Limpa o estado global geométrico com segurança
    if (typeof _tempHighlightState !== 'undefined') {
        _tempHighlightState.rects = null;
        _tempHighlightState.paginaFisica = null;
    }
    
    if (window.getSelection) window.getSelection().removeAllRanges();
    
    const header = document.getElementById('popup-topic-color-feedback');
    if(header) header.style.height = '0';
}

function exibirPopupClassificacao(tipo, conteudo) {
    window.toggleModoFoco(true);
    if (topicos.length === 0) {
        exibirToast('Crie pelo menos um Tópico Recursal.', 'aviso'); return;
    }
    pendingTipo = tipo;
    pendingConteudo = conteudo;

    DropdownManager.renderizar('seletor-topico', topicos);

    document.getElementById('agrupamento-popup-box').style.display = 'none';
    document.querySelector('input[name="modo_agrupar_popup"][value="nova"]').checked = true;
    toggleAgruparPopup();

    renderizarFasesModais('popup');
    const tabsPopup = document.getElementById('popup-phase-tabs');
    if(tabsPopup && tabsPopup.firstElementChild) tabsPopup.firstElementChild.click();

    const popup = document.getElementById('classification-popup');
    popup.style.display = 'flex';
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';

    const txtArea = document.getElementById('comentario-input');
    txtArea.value = '';
    if (tipo === 'imagem') {
        txtArea.style.display = 'block';
        requestAnimationFrame(() => requestAnimationFrame(() => txtArea.focus()));
    } else {
        txtArea.style.display = 'none';
    }
}

document.getElementById('seletor-topico').addEventListener('change', (e) => {
    // 1. Controla exibição do agrupamento
    const box = document.getElementById('agrupamento-popup-box');
    box.style.display = e.target.value ? 'flex' : 'none';
    
    // 2. Controla o feedback visual de cor desacoplado (lê data-cor injetado na option)
    const header = document.getElementById('popup-topic-color-feedback');
    const selectedOpt = e.target.options[e.target.selectedIndex];
    
    if (e.target.value && selectedOpt.dataset.cor) {
        header.style.backgroundColor = selectedOpt.dataset.cor;
        header.style.height = '6px';
    } else {
        header.style.height = '0';
        header.style.backgroundColor = 'transparent';
    }
});

/* ================================================
   MÓDULO: EXTRATOR INTELIGENTE DE TEXTO (ALFINETE)
   ================================================ */
window.iniciarMarcadorExtracao = function() {
    if (topicos.length === 0) {
        exibirToast('Crie uma análise de vício recursal primeiro.', 'aviso'); return;
    }
    if (modoRecorteAtivo) desativarOverlayRecorte(); 
    
    modoExtratorAtivo = true;
    document.body.classList.add('modo-extrator-ativo');
    
    const r = document.getElementById('pdf-container').getBoundingClientRect();
    overlay.style.cssText = `position:fixed; left:${r.left}px; top:${r.top}px; width:${r.width}px; height:${r.height}px; display:block;`;
    
    exibirToast('Clique na linha do PDF onde o texto começa ou termina.', 'info');
};

window.salvarMarcadorExtracao = function() {
    const topicoId = document.getElementById('extrator-topic-select').value;
    const docTipo = document.getElementById('extrator-doc-select').value;
    const fronteira = document.getElementById('extrator-fronteira-select').value;
    
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico.marcosExtracao) topico.marcosExtracao = [];
    
    topico.marcosExtracao = topico.marcosExtracao.filter(m => !(m.docTipo === docTipo && m.fronteira === fronteira));
    topico.marcosExtracao.push({ ...extratorTempState, docTipo, fronteira });

    cancelarMarcadorExtracao();
    exibirToast(`Marco de ${fronteira} definido com sucesso!`, 'sucesso');
    
    if(window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    if(typeof salvarBackupAutomatico === 'function') salvarBackupAutomatico();
    
    // [NOVO] Valida o botão imediatamente após salvar um novo marco
    if (window.atualizarStatusBotaoExtrator) window.atualizarStatusBotaoExtrator();
};

window.cancelarMarcadorExtracao = function() {
    document.getElementById('extrator-modal-backdrop').style.display = 'none';
    document.getElementById('extrator-wizard-popup').style.display = 'none';
    extratorTempState = null;
    modoExtratorAtivo = false;
    document.body.classList.remove('modo-extrator-ativo');
    if (!modoRecorteAtivo) overlay.style.display = 'none';
};

/* ================================================
   DISPATCHER DE EVENTOS DO OVERLAY (RECORTE E EXTRATOR)
   ================================================ */

overlay.addEventListener('mousedown', function (e) {
    if (modoExtratorAtivo) {
        const rect = overlay.getBoundingClientRect();
        let targetContainer = null, localY = 0;
        
        document.querySelectorAll('.pdf-page-container').forEach(container => {
            const r = container.getBoundingClientRect();
            if (e.clientY >= r.top && e.clientY <= r.bottom) {
                targetContainer = container;
                localY = e.clientY - r.top; 
            }
        });

        if (!targetContainer) return;
        
        extratorTempState = { 
            pagina: parseInt(targetContainer.dataset.pageNumber), 
            offsetY: localY 
        };
        
        modoExtratorAtivo = false;
        document.body.classList.remove('modo-extrator-ativo');
        overlay.style.display = 'none';

        const activeTabId = (typeof TopicsManager !== 'undefined') ? TopicsManager.getActiveTabId() : null;
        DropdownManager.renderizar('extrator-topic-select', topicos, activeTabId);
        
        document.getElementById('extrator-modal-backdrop').style.display = 'block';
        document.getElementById('extrator-wizard-popup').style.display = 'flex';
        return; // Early return bloqueia a execução do Recorte
    }

    const rect = overlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    if (cropBox) cropBox.remove();
    cropBox = document.createElement('div');
    cropBox.id = 'crop-box';
    cropBox.style.cssText = `left:${startX}px; top:${startY}px; width:0; height:0;`;
    overlay.appendChild(cropBox);
});

overlay.addEventListener('mousemove', function (e) {
    if (!cropBox) return;
    const rect = overlay.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    cropBox.style.width  = Math.abs(curX - startX) + 'px';
    cropBox.style.height = Math.abs(curY - startY) + 'px';
    cropBox.style.left   = Math.min(startX, curX)  + 'px';
    cropBox.style.top    = Math.min(startY, curY)  + 'px';
});

overlay.addEventListener('mouseup', function (e) {
    if (!cropBox) return;

    const cropW = parseFloat(cropBox.style.width);
    const cropH = parseFloat(cropBox.style.height);

    if (cropW < 5 || cropH < 5) {
        cropBox.remove();
        cropBox = null;
        return;
    }

    const overlayRect = overlay.getBoundingClientRect();
    const cropLeft = parseFloat(cropBox.style.left) + overlayRect.left;
    const cropTop  = parseFloat(cropBox.style.top)  + overlayRect.top;

    const cropCenterX = cropLeft + cropW / 2;
    const cropCenterY = cropTop  + cropH / 2;

    let targetContainer = null;
    document.querySelectorAll('.pdf-page-container').forEach(container => {
        const r = container.getBoundingClientRect();
        if (cropCenterX >= r.left && cropCenterX <= r.right &&
            cropCenterY >= r.top  && cropCenterY <= r.bottom) {
            targetContainer = container;
        }
    });

    if (!targetContainer) {
        cropBox.remove();
        cropBox = null;
        exibirToast('Selecione uma área dentro de uma página do documento.', 'aviso');
        // CORREÇÃO: Removido desativarOverlayRecorte() para não quebrar o fluxo.
        return;
    }

    const canvas = targetContainer.querySelector('canvas');
    if (!canvas) {
        cropBox.remove();
        cropBox = null;
        exibirToast('Página ainda sendo renderizada. Aguarde um instante e tente novamente.', 'aviso');
        return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const relX = cropLeft - canvasRect.left;
    const relY = cropTop  - canvasRect.top;

    const srcX = Math.max(0, relX);
    const srcY = Math.max(0, relY);
    const srcW = Math.min(cropW - Math.max(0, -relX), canvasRect.width  - srcX);
    const srcH = Math.min(cropH - Math.max(0, -relY), canvasRect.height - srcY);

    if (srcW <= 0 || srcH <= 0) {
        cropBox.remove();
        cropBox = null;
        exibirToast('Selecione uma área dentro da página do documento.', 'aviso');
        // CORREÇÃO: Removido desativarOverlayRecorte() para não quebrar o fluxo.
        return;
    }

    // --- CAPTURA DE COORDENADAS PARA O CRACHÁ ---
    const containerRect = targetContainer.getBoundingClientRect();
    _tempHighlightState.rects = [{
        top: cropTop - containerRect.top,
        left: cropLeft - containerRect.left,
        width: cropW,
        height: cropH
    }];
    _tempHighlightState.paginaFisica = parseInt(targetContainer.dataset.pageNumber);
    // ------------------------------------------------

    const scaleX = canvas.width  / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;

    const recorteCanvas = document.createElement('canvas');
    recorteCanvas.width  = Math.round(srcW * scaleX);
    recorteCanvas.height = Math.round(srcH * scaleY);

    try {
        recorteCanvas.getContext('2d').drawImage(
            canvas,
            Math.round(srcX * scaleX), Math.round(srcY * scaleY),
            recorteCanvas.width,       recorteCanvas.height,
            0, 0,
            recorteCanvas.width,       recorteCanvas.height
        );
        const imageDataUrl = recorteCanvas.toDataURL('image/png');

        currentPage = parseInt(targetContainer.dataset.pageNumber);

        _wizardImagemCapturada = imageDataUrl;
        abrirConfirmacaoRecorteWizard();
    } catch (err) {
        console.error('Erro ao processar recorte:', err);
        exibirToast('Erro ao processar o recorte. Tente novamente.', 'erro');
    }

    cropBox.remove();
    cropBox = null;
    desativarOverlayRecorte();
});

/* ================================================
   ATALHOS DE TECLADO E ACESSIBILIDADE
   ================================================ */
document.addEventListener('keydown', function(e) {
    // Se a tecla for ESC e o overlay de recorte estiver ativo, abortamos o processo
    if (e.key === 'Escape' && modoRecorteAtivo) {
        // Limpa o quadrado em progresso, se houver
        if (cropBox) {
            cropBox.remove();
            cropBox = null;
        }
        // Restaura todo o estado, desliga o foco e remove o overlay
        cancelarRecorteWizard();
        exibirToast('Recorte cancelado.', 'info');
    }
});

/* ================================================
   MÓDULO: GERADOR DE CONTEXTO ESTRUTURADO (IA)
   ================================================ */

// Função utilitária de Debounce para proteger o Main Thread
function _debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/* --- NOVA FUNÇÃO DE LIMPEZA MANUAL --- */
window.limparAreaInternaLGPD = function() {
    document.getElementById('ctx-teor-decisao').value = '';
    document.getElementById('ctx-teor-embargos').value = '';
    document.getElementById('ctx-teor-confronto').value = '';
    sessionStorage.removeItem('juris_ed_ctx_decisao');
    sessionStorage.removeItem('juris_ed_ctx_embargos');
    sessionStorage.removeItem('juris_ed_ctx_confronto');
    exibirToast('Área restrita limpa.', 'info');
};

/* --- MICRO-SERVIÇOS DA ÁREA DA MINUTA --- */
window.limparMinutaAnterior = function() {
    const textarea = document.getElementById('ctx-minuta-anterior');
    if (textarea) {
        textarea.value = '';
        sessionStorage.removeItem('juris_ed_ctx_minuta');
        exibirToast('Texto da minuta limpo.', 'info');
    }
};

window.colarNaMinuta = async function() {
    const textarea = document.getElementById('ctx-minuta-anterior');
    if (!textarea) return;
    
    try {
        const text = await navigator.clipboard.readText();
        textarea.value = text;
        window.salvarRascunhoContextoDebounced();
        exibirToast('Texto colado com sucesso!', 'sucesso');
    } catch (err) {
        console.warn('Fallback ativado: Permissão de Clipboard bloqueada.');
        textarea.focus();
        exibirToast('Permissão bloqueada. Pressione Ctrl+V para colar.', 'aviso');
    }
};

/* --- ATUALIZAÇÃO DO AUTO-SAVE COM INJEÇÃO DE HASH DO PROCESSO --- */
window.salvarRascunhoContextoDebounced = _debounce(function() {
    try {
        const minuta = document.getElementById('ctx-minuta-anterior').value;
        const rascunho = document.getElementById('ctx-rascunho-ia').value;
        const decisao = document.getElementById('ctx-teor-decisao').value;
        const embargos = document.getElementById('ctx-teor-embargos').value;
        const confronto = document.getElementById('ctx-teor-confronto').value;
        
        // Captura o processo atual como ID de Segurança
        const tagProcesso = document.getElementById('tag-numero-processo');
        const numProcesso = tagProcesso ? tagProcesso.textContent.trim() : 'sem-processo';
        
        sessionStorage.setItem('juris_ed_ctx_minuta', minuta);
        sessionStorage.setItem('juris_ed_ctx_rascunho', rascunho);
        
        // Só salva o sigilo se houver dados, amarrado ao ID do processo atual
        sessionStorage.setItem('juris_ed_ctx_decisao', decisao);
        sessionStorage.setItem('juris_ed_ctx_embargos', embargos);
        sessionStorage.setItem('juris_ed_ctx_confronto', confronto);
        sessionStorage.setItem('juris_ed_ctx_processo_ref', numProcesso);
    } catch (e) {
        console.warn('Falha ao acessar sessionStorage:', e);
    }
}, 800);

/* --- ABERTURA ASSÍNCRONA DO MODAL DE CONTEXTO (COM EXTRAÇÃO JIT - ED) --- */
window.abrirModalGeradorContexto = async function() {
    if (!window.ExportManager) return;
    const dadosTopico = ExportManager.obterDadosDoTopicoAtivo();
    if (!dadosTopico) {
        exibirToast('Selecione um tópico com provas estruturadas antes de gerar o contexto.', 'aviso');
        return;
    }

    // 1. UI UNBLOCKING: Feedback visual imediato antes da operação pesada
    const btnGerador = document.getElementById('btn-gerador-contexto');
    const originalHTML = btnGerador.innerHTML;
    btnGerador.innerHTML = "⏳";
    btnGerador.style.pointerEvents = "none";

    // Cede controle para o navegador renderizar o loading (micro-delay)
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // 2. EXTRAÇÃO ASSÍNCRONA DINÂMICA (Baseada nos Pinos)
        const topicoBruto = topicos.find(t => t.id === TopicsManager.getActiveTabId());
        
        if (topicoBruto && topicoBruto.marcosExtracao && topicoBruto.marcosExtracao.length > 0) {
            // Agrupar marcos pareados por tipo de documento
            const agrupados = topicoBruto.marcosExtracao.reduce((acc, curr) => {
                if(!acc[curr.docTipo]) acc[curr.docTipo] = {};
                acc[curr.docTipo][curr.fronteira] = curr;
                return acc;
            }, {});

            let decisaoXML = "";
            let embargosXML = "";
            let confrontoXML = "";

            for (const [docTipo, limites] of Object.entries(agrupados)) {
                if (limites.inicio && limites.fim) {
                    const pInicio = Math.min(limites.inicio.pagina, limites.fim.pagina);
                    const pFim = Math.max(limites.inicio.pagina, limites.fim.pagina);
                    const amostrasMap = new Map();

                    // EXTRAÇÃO COM COLETA DE AMOSTRAGEM (necessária para a camada automática de ruído)
                    const textoBruto = await window.PdfEngine.extrairTextoPorRegiao(
                        limites.inicio,
                        limites.fim,
                        null, // onProgress — não usado neste fluxo
                        (pageNum, rawText) => {
                            if (pageNum === pInicio + 1 || pageNum === pInicio + 2 || pageNum === pFim - 1) {
                                amostrasMap.set(pageNum, rawText);
                            }
                        }
                    );

                    let textoLimpo = window.JurisUtils.limparTextoPDF(textoBruto);

                    // DELEGAÇÃO INTEGRAL DA SANITIZAÇÃO (mesma função usada na exportação TXT)
                    if (typeof window.ExportManager?.aplicarFiltrosAvancados === 'function') {
                        textoLimpo = window.ExportManager.aplicarFiltrosAvancados(textoLimpo, docTipo, amostrasMap, pInicio, pFim);
                    }

                    // GERAÇÃO DE XML PROFUNDO PARA A IA
                    const tagName = docTipo.toUpperCase();
                    const xml = `\n<${tagName}>\n${textoLimpo}\n</${tagName}>\n`;

                    if (docTipo === 'decisao') decisaoXML += xml;
                    else if (docTipo === 'embargos') embargosXML += xml;
                    else confrontoXML += xml;
                }
            }

            // Injeta nas textareas protegidas por LGPD
            if (decisaoXML) sessionStorage.setItem('juris_ed_ctx_decisao', decisaoXML.trim());
            if (embargosXML) sessionStorage.setItem('juris_ed_ctx_embargos', embargosXML.trim());
            if (confrontoXML) sessionStorage.setItem('juris_ed_ctx_confronto', confrontoXML.trim());
        }

        // 3. FLUXO ORIGINAL DE ABERTURA DO MODAL
        const tagProcesso = document.getElementById('tag-numero-processo');
        const numProcessoAtual = tagProcesso ? (tagProcesso.textContent.trim() || 'Não informado') : 'Não informado';
        
        document.getElementById('ctx-metadados').value = `Processo: ${numProcessoAtual}\nVício Analisado: ${dadosTopico.nome}`;
        document.getElementById('ctx-diretrizes').value = dadosTopico.markdown;
        
        document.getElementById('ctx-minuta-anterior').value = sessionStorage.getItem('juris_ed_ctx_minuta') || '';
        document.getElementById('ctx-rascunho-ia').value = sessionStorage.getItem('juris_ed_ctx_rascunho') || '';
        
        const processoSalvoRef = sessionStorage.getItem('juris_ed_ctx_processo_ref');
        if (processoSalvoRef && processoSalvoRef !== numProcessoAtual) {
            window.limparAreaInternaLGPD();
            sessionStorage.setItem('juris_ed_ctx_processo_ref', numProcessoAtual);
        } else {
            document.getElementById('ctx-teor-decisao').value = sessionStorage.getItem('juris_ed_ctx_decisao') || '';
            document.getElementById('ctx-teor-embargos').value = sessionStorage.getItem('juris_ed_ctx_embargos') || '';
            document.getElementById('ctx-teor-confronto').value = sessionStorage.getItem('juris_ed_ctx_confronto') || '';
        }

        const painelPdf = document.getElementById('pdf-container');
        const painelAnotacoes = document.getElementById('history-container');
        if (painelPdf) painelPdf.classList.add('pdf-foco-ativo');
        if (painelAnotacoes) painelAnotacoes.classList.add('pdf-foco-ativo');

        document.getElementById('gerador-contexto-backdrop').style.display = 'block';
        document.getElementById('modal-gerador-contexto').style.display = 'flex';

    } catch (error) {
        console.error("Erro na compilação do contexto:", error);
        exibirToast("Erro ao processar os trechos. Tente marcar novamente.", "erro");
    } finally {
        btnGerador.innerHTML = originalHTML;
        btnGerador.style.pointerEvents = "auto";
    }
};

window.fecharModalGeradorContexto = function() {
    // Remove o efeito de desfoque
    const painelPdf = document.getElementById('pdf-container');
    const painelAnotacoes = document.getElementById('history-container');
    if (painelPdf) painelPdf.classList.remove('pdf-foco-ativo');
    if (painelAnotacoes) painelAnotacoes.classList.remove('pdf-foco-ativo');

    document.getElementById('gerador-contexto-backdrop').style.display = 'none';
    document.getElementById('modal-gerador-contexto').style.display = 'none';
};

/* --- ATUALIZAÇÃO DA EXPORTAÇÃO COM TRAVA LGPD E TAGS XML --- */
window.gerarECopiarContexto = function(modo = 'pro') {
    const nomeAcao = modo === 'interno' ? 'copiar DADOS COMPLETOS para ChatJT' : 'copiar DADOS SEGUROS para Gemini PRO';
    
    // Guardrail context-aware
    if (window.BalancaManager && !window.BalancaManager.executarGuardrailDeTarefas(nomeAcao)) {
        exibirToast('Cópia interrompida pelo usuário.', 'aviso');
        return; 
    }

    const btnId = modo === 'interno' ? 'btn-copiar-contexto-interno' : 'btn-copiar-contexto-pro';
    const btn = document.getElementById(btnId);
    
    // Mutação Atômica - Apenas UMA declaração de originalText
    const targetTextNode = btn.querySelector('.btn-main-text');
    const originalText = targetTextNode.innerText;
    
    // Concatenação Inteligente
    let outputFinal = "";
    const minuta = document.getElementById('ctx-minuta-anterior').value.trim();
    if (minuta) outputFinal += "== MINUTA_ATUAL ==\n" + minuta + "\n\n";
    
    outputFinal += "== METADADOS E TÓPICO ==\n" + document.getElementById('ctx-metadados').value.trim() + "\n\n";
    outputFinal += "== DIRETRIZES DE AUDITORIA ==\n" + document.getElementById('ctx-diretrizes').value.trim() + "\n\n";
    
    const rascunho = document.getElementById('ctx-rascunho-ia').value.trim();
    if (rascunho) outputFinal += "== RASCUNHO BASE ==\n" + rascunho + "\n\n";

    // INJEÇÃO XML SIGILOSA: Só ocorre se o modo for interno
    if (modo === 'interno') {
        const decisao = document.getElementById('ctx-teor-decisao').value.trim();
        const embargos = document.getElementById('ctx-teor-embargos').value.trim();
        const confronto = document.getElementById('ctx-teor-confronto').value.trim();

        if (decisao || embargos || confronto) {
            outputFinal += "<relatorio_do_conflito>\n";
            if (decisao) {
                outputFinal += "  <inteiro_teor_decisao_embargada>\n";
                // Identação profunda para delimitar pro LLM
                outputFinal += `    ${decisao.replace(/\n/g, '\n    ')}\n`; 
                outputFinal += "  </inteiro_teor_decisao_embargada>\n\n";
            }
            if (embargos) {
                outputFinal += "  <inteiro_teor_embargos>\n";
                outputFinal += `    ${embargos.replace(/\n/g, '\n    ')}\n`;
                outputFinal += "  </inteiro_teor_embargos>\n\n";
            }
            if (confronto) {
                outputFinal += "  <documentos_de_confronto>\n";
                outputFinal += `    ${confronto.replace(/\n/g, '\n    ')}\n`;
                outputFinal += "  </documentos_de_confronto>\n";
            }
            outputFinal += "</relatorio_do_conflito>\n";
        }
    }

    // Feedback Visual Progressivo (Mutação Limpa sem Layout Shift)
    targetTextNode.innerText = '⏳ Copiando...';
    btn.style.opacity = "0.8";

    if (!navigator.clipboard) {
        executarCopiaFallback(outputFinal, btn, targetTextNode, originalText, modo);
        return;
    }

    navigator.clipboard.writeText(outputFinal).then(() => {
        targetTextNode.innerText = '✅ Sucesso!';
        btn.style.backgroundColor = "#2e7d32"; 
        btn.style.opacity = "1";
        
        const msgToast = modo === 'interno' ? 'Pacote Interno copiado (com XML).' : 'Pacote PRO seguro copiado.';
        exibirToast(msgToast, 'sucesso');
        
        setTimeout(() => {
            targetTextNode.innerText = originalText;
            btn.style.backgroundColor = modo === 'interno' ? '#f57c00' : 'var(--trt-blue)';
            if(typeof window.fecharModalGeradorContexto === 'function') window.fecharModalGeradorContexto();
        }, 1500); 
        
    }).catch(err => {
        console.error('Falha na Clipboard API:', err);
        executarCopiaFallback(outputFinal, btn, targetTextNode, originalText, modo);
    });
};

function executarCopiaFallback(texto, btn, targetTextNode, originalText, modo) {
    targetTextNode.innerText = '⚠️ Falhou';
    btn.style.backgroundColor = "#d32f2f";
    btn.style.opacity = "1";
    exibirToast('Permissão negada. Copie manualmente (Ctrl+A, Ctrl+C).', 'erro');
    
    // Retorna visual do botão após 3s, mas NÃO fecha o modal
    setTimeout(() => {
        targetTextNode.innerText = originalText;
        btn.style.backgroundColor = modo === 'interno' ? '#f57c00' : 'var(--trt-blue)';
    }, 3000);
}

/* ================================================
   GATILHO DE SEGURANÇA: CONTROLE DE FERRAMENTAS
   ================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const btnTexto = document.getElementById('btn-ferramenta-texto');
    const btnRecorte = document.getElementById('btn-ferramenta-recorte');
    if(btnTexto) btnTexto.removeAttribute('disabled');
    if(btnRecorte) btnRecorte.removeAttribute('disabled');
});

/* ================================================
   DELEGAÇÃO DE EVENTOS (EVENT DELEGATION) - TOOLTIPS DOS ALFINETES
   ================================================ */
// Singleton para Cache do elemento Tooltip
let _cachedTooltip = null;

document.addEventListener('mouseover', (e) => {
    const pin = e.target.closest('.pdf-extrator-pin');
    if (!pin) return;

    if (!_cachedTooltip) _cachedTooltip = document.getElementById('quick-intent-tooltip');
    if (!_cachedTooltip) return;

    // 1. STATE SYNC: Cancela temporizadores pendentes no elemento global (previne concorrência de timers)
    if (_cachedTooltip._timer) clearTimeout(_cachedTooltip._timer);

    const fronteira = pin.dataset.tooltipFronteira === 'inicio' ? 'INÍCIO' : 'FIM';
    const docTipo = pin.dataset.tooltipDoc;
    const topicoNome = pin.dataset.tooltipTopico;

    // Dicionário visual adaptado consumindo a SSOT
    const nomeBonito = window.ExportManager ? window.ExportManager.getDocLabel(docTipo) : (docTipo ? docTipo.toUpperCase() : 'DESCONHECIDO');
    const corFronteira = fronteira === 'INÍCIO' ? '#34db98' : '#e74c3c';

    // 2. DOM MUTATION: Injeta o novo conteúdo e semântica de cores
    _cachedTooltip.innerHTML = `
        <strong style="color: ${corFronteira};">📍 MARCO DE ${fronteira}</strong>
        <span style="display:block; margin-top:4px; font-size: 0.8rem; color:#ecf0f1;">
            <b>Doc:</b> ${nomeBonito}<br>
            <b>Tópico:</b> ${topicoNome}
        </span>
    `;

    // Garante que o elemento seja posicionado em display block mas permaneça temporariamente invisível
    _cachedTooltip.classList.remove('visible');
    _cachedTooltip.style.display = 'block';

    // 3. ANCORAGEM GEOMÉTRICA FIXA: Cálculo estático com base na posição física do pino
    const pinRect = pin.getBoundingClientRect();
    const tooltipRect = _cachedTooltip.getBoundingClientRect();
    
    let x = pinRect.left + (pinRect.width / 2) - (tooltipRect.width / 2);
    let y = pinRect.bottom + 10;

    // Proteção de limites da Viewport (Viewport Collision Prevention)
    if (x + tooltipRect.width > window.innerWidth) x = window.innerWidth - tooltipRect.width - 15;
    if (x < 0) x = 15;
    if (y + tooltipRect.height > window.innerHeight) y = pinRect.top - tooltipRect.height - 10;

    _cachedTooltip.style.left = `${x}px`;
    _cachedTooltip.style.top = `${y}px`;

    // 4. PAINT/ANIMATION TIER: Exibição gradual sob agendamento
    _cachedTooltip._timer = setTimeout(() => {
        requestAnimationFrame(() => _cachedTooltip.classList.add('visible'));
    }, 150);
});

document.addEventListener('mouseout', (e) => {
    const pin = e.target.closest('.pdf-extrator-pin');
    if (!pin || !_cachedTooltip) return;

    // BOUNDARY CHECK: Se o movimento ocorreu dentro dos limites internos do próprio pino, ignora o fechamento
    if (pin.contains(e.relatedTarget)) return;

    // Cancela o ciclo de exibição caso o mouse saia antes de expirar o timeout de ativação
    if (_cachedTooltip._timer) clearTimeout(_cachedTooltip._timer);

    _cachedTooltip.classList.remove('visible');
    
    // Libera o espaço de exibição no DOM após o encerramento da transição de opacidade (200ms)
    _cachedTooltip._timer = setTimeout(() => { 
        _cachedTooltip.style.display = 'none'; 
    }, 200);
});
