window.PromptUIController = (function() {
    let prompts = [];
    let currentActivePrompt = null;
    let currentExecutionContext = { parentId: null, stepIdx: null };
    let editingCustomFields = [];
    let editingSubPromptIds = [];
    let initialFormSnapshot = null;
    let expandedBranchIds = new Set();
    
    // Estado de execução exclusivo para rotinas com ramificação: "${parentId}::ROOT" e "${parentId}::${subId}::${stepIdx}"
    let executedRoutineSteps = new Set();
    let isSyncing = false; // Semáforo de concorrência

    const STORAGE_DIRECT_COPY_KEY = 'juris_prompts_direct_copy';
    const STORAGE_DIRECT_COPY_TS_KEY = 'juris_prompts_direct_copy_ts';
    let directCopyEnabled = localStorage.getItem(STORAGE_DIRECT_COPY_KEY) !== 'false';

    const getEl = (id) => document.getElementById(id);

    function _syncAllDirectCopyToggles() {
        document.querySelectorAll('[data-jp-direct-toggle="true"]').forEach(chk => {
            chk.checked = directCopyEnabled;
        });
    }

    // Utilitário 1: Normalização Diacrítica (Remove acentos e converte para minúsculas)
    function normalizeText(str = '') {
        return String(str)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    // Utilitário 2: Limpeza de Emojis/Símbolos iniciais para Ordenação Alfabética Real
    function cleanTitleForSort(str = '') {
        return normalizeText(String(str).replace(/^[^\p{L}\p{N}]+/gu, ''));
    }

    // Utilitário 3: Ordenação Padrão (1º Favoritos no topo, 2º Ordem Alfabética Limpa)
    function getDefaultSortedPrompts(list = prompts) {
        return [...list].sort((a, b) => {
            const favA = Boolean(a.favorite);
            const favB = Boolean(b.favorite);
            if (favA !== favB) return favA ? -1 : 1;
            return cleanTitleForSort(a.title).localeCompare(cleanTitleForSort(b.title), 'pt-BR');
        });
    }

    // Utilitário 4: Escape básico de HTML para evitar quebra de DOM em títulos com caracteres especiais
    function escapeHtml(str = '') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function hasInteractiveFields(promptObj) {
        return Boolean(promptObj && Array.isArray(promptObj.customFields) && promptObj.customFields.length > 0);
    }

    function getResolvedSubPrompts(parentPrompt) {
        if (!parentPrompt || !Array.isArray(parentPrompt.subPromptIds)) return [];
        const promptMap = new Map(prompts.map(item => [item.id, item]));
        return parentPrompt.subPromptIds
            .map(subId => promptMap.get(subId))
            .filter(Boolean);
    }

    function getParentRoutinesUsing(targetId) {
        return prompts.filter(p => p.id !== targetId && Array.isArray(p.subPromptIds) && p.subPromptIds.includes(targetId));
    }

    function _buildBranchButtonTitle(subCount, isExpanded) {
        if (subCount <= 0) return 'Vincular subprompts a este modelo';
        return `${isExpanded ? 'Ocultar' : 'Expandir'} ramificação (${subCount} subprompt${subCount > 1 ? 's' : ''})`;
    }

    // Verificador de Autenticação (Auth Guard)
    function verificarSessao() {
        const btnLogin = document.getElementById('btn-login-user');
        if (btnLogin && !btnLogin.classList.contains('is-logged-in')) {
            if (window.exibirToast) window.exibirToast('Você precisa estar conectado à nuvem.', 'aviso');
            if (typeof toggleLoginMenu === 'function') toggleLoginMenu();
            return false;
        }
        return true;
    }

    function _getNextStepIndex(parentPrompt, subPrompts) {
        if (!parentPrompt || subPrompts.length === 0) return -1;
        const rootCopied = executedRoutineSteps.has(`${parentPrompt.id}::ROOT`);
        const anySubCopied = subPrompts.some((sub, idx) => executedRoutineSteps.has(`${parentPrompt.id}::${sub.id}::${idx}`));
        
        if (!rootCopied && !anySubCopied) return -1;

        for (let idx = 0; idx < subPrompts.length; idx++) {
            const sub = subPrompts[idx];
            if (!executedRoutineSteps.has(`${parentPrompt.id}::${sub.id}::${idx}`)) {
                return idx;
            }
        }
        return -1;
    }

    function _updateRoutineDOMState(parentId) {
        const groupEl = document.querySelector(`.jp-card-group[data-prompt-id="${CSS.escape(parentId)}"]`);
        if (!groupEl) return;

        const parentPrompt = prompts.find(p => p.id === parentId);
        if (!parentPrompt) return;

        const subPrompts = getResolvedSubPrompts(parentPrompt);
        const mainCard = groupEl.querySelector(':scope > .jp-card');
        if (mainCard) {
            const showRootCopied = subPrompts.length > 0 && executedRoutineSteps.has(`${parentId}::ROOT`);
            mainCard.classList.toggle('was-copied', showRootCopied);
        }

        const nextStepIdx = _getNextStepIndex(parentPrompt, subPrompts);
        const subCardEls = groupEl.querySelectorAll('.jp-subcard');
        subCardEls.forEach((subEl, idx) => {
            const subId = subEl.dataset.subId;
            const isCopied = executedRoutineSteps.has(`${parentId}::${subId}::${idx}`);
            const isNext = (idx === nextStepIdx);
            subEl.classList.toggle('was-copied', isCopied);
            subEl.classList.toggle('is-next-step', isNext);
        });
    }

    function _flashStandaloneCard(promptId) {
        const groupEl = document.querySelector(`.jp-card-group[data-prompt-id="${CSS.escape(promptId)}"]`);
        const mainCard = groupEl ? groupEl.querySelector(':scope > .jp-card') : null;
        if (!mainCard) return;

        mainCard.classList.add('just-copied-flash');
        clearTimeout(mainCard._flashTimer);
        mainCard._flashTimer = setTimeout(() => {
            mainCard.classList.remove('just-copied-flash');
        }, 1200);
    }

    function resetRoutineProgress(parentId, silent = false) {
        const prefix = `${parentId}::`;
        for (const key of Array.from(executedRoutineSteps)) {
            if (key.startsWith(prefix)) executedRoutineSteps.delete(key);
        }
        _updateRoutineDOMState(parentId);
        if (!silent && window.exibirToast) {
            window.exibirToast('Progresso da rotina reiniciado.', 'info');
        }
    }

    // Renderização Pura da Lista (Recebe dados ordenados e Set opcional de IDs com match apenas no conteúdo)
    function renderList(data = null, contentMatchIds = null) {
        const list = getEl('jp-list');
        if (!list) return;
        list.innerHTML = '';

        const itemsToRender = data !== null ? data : getDefaultSortedPrompts(prompts);

        if (itemsToRender.length === 0) {
            list.innerHTML = `<div style="text-align: center; color: #64748b; padding: 2rem; border: 1px dashed #cbd5e0; border-radius: 8px;">Nenhum modelo encontrado.</div>`;
            return;
        }

        itemsToRender.forEach(p => {
            const hasExtras = hasInteractiveFields(p);
            const badgeExtras = hasExtras 
                ? `<span class="jp-badge-extras">+${p.customFields.length} extras</span>` 
                : '';
            
            const parentRoutines = getParentRoutinesUsing(p.id);
            const badgeShared = parentRoutines.length > 0
                ? `<span class="jp-badge-shared" title="Usado como subprompt em: ${escapeHtml(parentRoutines.map(r => r.title).join(', '))}">↳ em ${parentRoutines.length} rotina${parentRoutines.length > 1 ? 's' : ''}</span>`
                : '';

            // Exibe indicador se o item apareceu na busca exclusivamente pelo conteúdo interno
            const isContentMatch = contentMatchIds && contentMatchIds.has(p.id);
            const badgeMatch = isContentMatch 
                ? `<span class="jp-badge-match" title="O termo pesquisado foi encontrado no teor deste prompt">Contém no texto</span>` 
                : '';

            const isFav = Boolean(p.favorite);
            const favClass = isFav ? 'is-fav' : '';
            const favTitle = isFav ? 'Remover dos favoritos' : 'Favoritar modelo';

            const subPrompts = getResolvedSubPrompts(p);
            const hasSubPrompts = subPrompts.length > 0;
            const isExpanded = hasSubPrompts && expandedBranchIds.has(p.id);
            const branchClass = isExpanded ? 'is-active' : (!hasSubPrompts ? 'is-empty' : '');
            const branchTitle = _buildBranchButtonTitle(subPrompts.length, isExpanded);

            const isDirect = !hasExtras && directCopyEnabled;
            const playTitle = isDirect 
                ? 'Copiar em 1-Click | Shift+Clique para abrir painel' 
                : 'Abrir painel para preenchimento';
            const playClass = isDirect ? 'is-direct-copy' : '';
            const rootWasCopied = (hasSubPrompts && executedRoutineSteps.has(`${p.id}::ROOT`)) ? 'was-copied' : '';
            const nextStepIdx = _getNextStepIndex(p, subPrompts);

            const group = document.createElement('div');
            group.className = `jp-card-group ${isExpanded ? 'is-expanded' : ''}`;
            group.dataset.promptId = p.id;

            const subCardsHtml = subPrompts.map((sub, idx) => {
                const subHasExtras = hasInteractiveFields(sub);
                const subBadgeExtras = subHasExtras 
                    ? `<span class="jp-badge-extras">+${sub.customFields.length} extras</span>` 
                    : '';
                const subIsDirect = !subHasExtras && directCopyEnabled;
                const subPlayTitle = subIsDirect
                    ? 'Copiar Subprompt em 1-Click | Shift+Clique para abrir painel'
                    : 'Gerar Subprompt';
                const stepCopied = executedRoutineSteps.has(`${p.id}::${sub.id}::${idx}`);
                const isNext = (idx === nextStepIdx);

                return `
                    <div class="jp-subcard ${stepCopied ? 'was-copied' : ''} ${isNext ? 'is-next-step' : ''}" data-sub-id="${sub.id}" data-step-idx="${idx}">
                        <div class="jp-card-info" style="gap: 10px;">
                            <span class="jp-subcard-step" title="Etapa ${idx + 1} da ramificação">${idx + 1}</span>
                            <div class="jp-title">
                                <span class="jp-subcard-title" title="${escapeHtml(sub.title)}">${escapeHtml(sub.title)}</span>
                                ${subBadgeExtras}
                                <span class="jp-next-pill">Próximo passo</span>
                            </div>
                        </div>
                        <div class="jp-actions">
                            <button class="jp-icon-btn jp-play ${subIsDirect ? 'is-direct-copy' : ''}" onclick="PromptUIController.handleGenerate('${sub.id}', event, '${p.id}', ${idx})" title="${subPlayTitle}">
                                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </button>
                            <button class="jp-icon-btn jp-edit" onclick="PromptUIController.openEditModal('${sub.id}')" title="Editar Subprompt">
                                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button class="jp-icon-btn jp-del" onclick="PromptUIController.deletePrompt('${sub.id}')" title="Excluir Subprompt">
                                <svg viewBox="0 0 24 24" style="stroke: var(--semantic-danger, #ef4444);"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            group.innerHTML = `
                <div class="jp-card ${rootWasCopied}">
                    <div class="jp-card-info">
                        <div class="jp-title">
                            <span class="jp-title-text" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>
                            ${badgeExtras}
                            ${badgeShared}
                            ${badgeMatch}
                        </div>
                    </div>
                    <div class="jp-actions">
                        <button class="jp-icon-btn jp-fav ${favClass}" aria-pressed="${isFav}" onclick="PromptUIController.toggleFavorite('${p.id}')" title="${favTitle}">
                            <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                        <button class="jp-icon-btn jp-branch ${branchClass}" aria-expanded="${isExpanded}" onclick="PromptUIController.toggleBranch('${p.id}')" title="${branchTitle}">
                            <svg viewBox="0 0 24 24">
                                <line x1="6" y1="3" x2="6" y2="15"></line>
                                <circle cx="18" cy="6" r="3"></circle>
                                <circle cx="6" cy="18" r="3"></circle>
                                <path d="M18 9a9 9 0 0 1-9 9"></path>
                            </svg>
                            ${hasSubPrompts ? `<span class="jp-branch-count">${subPrompts.length}</span>` : ''}
                        </button>
                        <button class="jp-icon-btn jp-play ${playClass}" onclick="PromptUIController.handleGenerate('${p.id}', event, '${p.id}', null)" title="${playTitle}">
                            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        </button>
                        <button class="jp-icon-btn jp-edit" onclick="PromptUIController.openEditModal('${p.id}')" title="Editar">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="jp-icon-btn jp-del" onclick="PromptUIController.deletePrompt('${p.id}')" title="Excluir">
                            <svg viewBox="0 0 24 24" style="stroke: var(--semantic-danger, #ef4444);"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
                ${hasSubPrompts ? `
                    <div class="jp-branch-container">
                        <div class="jp-branch-toolbar">
                            <span>Sequência de Subprompts (${subPrompts.length} etapa${subPrompts.length > 1 ? 's' : ''})</span>
                            <button type="button" class="jp-btn-reset-routine" onclick="PromptUIController.resetRoutineProgress('${p.id}')">↺ Reiniciar sequência</button>
                        </div>
                        ${subCardsHtml}
                    </div>
                ` : ''}
            `;
            list.appendChild(group);
        });
    }

    function renderBuilder() {
        const c = getEl('jp-builder-container');
        if (!c) return;
        c.innerHTML = '';
        editingCustomFields.forEach((field, index) => {
            const card = document.createElement('div');
            card.className = 'jp-field-card';
            let spec = '';
            if (field.type === 'checkbox') {
                spec = `
                    <label style="font-size:0.8rem; margin-top:8px; display:block; color: #475569;">Opções (uma por linha):</label>
                    <textarea class="jp-input" style="min-height:60px; padding:0.5rem;" onchange="PromptUIController.updField(${index}, 'options', this.value)" required>${escapeHtml(field.options || '')}</textarea>
                    
                    <label style="font-size:0.8rem; margin-top:8px; display:block; color: #475569;">Diretrizes Específicas p/ IA (Opcional):</label>
                    <textarea class="jp-input" style="min-height:45px; padding:0.5rem; background-color: #f8fafc;" placeholder="Ex: Liste as escolhas em formato de bullet points curtos..." onchange="PromptUIController.updField(${index}, 'guidelines', this.value)">${escapeHtml(field.guidelines || '')}</textarea>
                `;
            }
            
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
                    <span style="background:#e2e8f0; padding:2px 8px; border-radius:12px; font-size:0.75rem;">${field.type.toUpperCase()}</span>
                    <span style="color:#ef4444; cursor:pointer; font-weight:bold;" onclick="PromptUIController.rmField(${index})">✕</span>
                </div>
                <input type="text" class="jp-input" placeholder="Título do Campo" value="${escapeHtml(field.label)}" onchange="PromptUIController.updField(${index}, 'label', this.value)" required>
                ${spec}
            `;
            c.appendChild(card);
        });
    }

    function renderSubPromptsBuilder() {
        const selectEl = getEl('jp-subprompt-select');
        const listEl = getEl('jp-subprompts-builder-list');
        const filterEl = getEl('jp-subprompt-filter');
        if (!selectEl || !listEl) return;

        const currentEditingId = getEl('jp-id')?.value || '';
        const filterTerm = normalizeText(filterEl ? filterEl.value : '');
        const promptMap = new Map(prompts.map(item => [item.id, item]));

        const candidates = getDefaultSortedPrompts(prompts).filter(p => {
            if (p.id === currentEditingId || editingSubPromptIds.includes(p.id)) return false;
            if (!filterTerm) return true;
            return normalizeText(p.title).includes(filterTerm) || normalizeText(p.content).includes(filterTerm);
        });

        selectEl.innerHTML = `<option value="">${candidates.length === 0 ? 'Nenhum modelo disponível para o filtro...' : 'Selecione um prompt salvo para vincular...'}</option>` +
            candidates.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('');

        const validLinkedIds = editingSubPromptIds.filter(id => promptMap.has(id));

        if (validLinkedIds.length === 0) {
            listEl.innerHTML = `<div style="font-size: 0.78rem; color: #94a3b8; text-align: center; padding: 0.75rem; border: 1px dashed #cbd5e0; border-radius: 6px;">Nenhum subprompt vinculado a esta rotina.</div>`;
            return;
        }

        listEl.innerHTML = validLinkedIds.map((subId, index) => {
            const sub = promptMap.get(subId);
            const isFirst = index === 0;
            const isLast = index === validLinkedIds.length - 1;
            return `
                <div class="jp-subprompt-builder-item">
                    <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                        <span class="jp-subcard-step">${index + 1}</span>
                        <span style="font-weight:600; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(sub.title)}">${escapeHtml(sub.title)}</span>
                    </div>
                    <div class="jp-subprompt-builder-actions">
                        <button type="button" class="jp-mini-btn" onclick="PromptUIController.moveSubPrompt(${index}, -1)" ${isFirst ? 'disabled' : ''} title="Mover para cima">↑</button>
                        <button type="button" class="jp-mini-btn" onclick="PromptUIController.moveSubPrompt(${index}, 1)" ${isLast ? 'disabled' : ''} title="Mover para baixo">↓</button>
                        <button type="button" class="jp-mini-btn danger" onclick="PromptUIController.rmSubPrompt(${index})" title="Desvincular desta rotina">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Restaura a visualização do Modal Principal usando o cache local (sem novo fetch na nuvem)
    function restaurarModalPrincipal() {
        getEl('backdrop-juris-prompts').classList.add('active');
        getEl('modal-juris-prompts').style.display = 'block';
        PromptUIController.filter();
    }

    // Abertura Modal Principal com Auth Guard e Fetch Inicial
    async function abrirModal() {
        if (!verificarSessao()) return;
        _syncAllDirectCopyToggles();

        getEl('backdrop-juris-prompts').classList.add('active');
        getEl('modal-juris-prompts').style.display = 'block';
        
        getEl('jp-list').innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b;">⏳ Sincronizando com a nuvem...</div>`;
        
        try {
            if (!window.FirebasePrompts) throw new Error("Módulo de nuvem não carregado.");
            const rawLoaded = await window.FirebasePrompts.carregar();
            prompts = (rawLoaded || []).filter(p => p && p.id !== '_prefs_config' && !p.isSystemConfig && typeof p.title === 'string');

            if (typeof window.FirebasePrompts.obterPreferenciasCache === 'function') {
                const cloudPrefs = window.FirebasePrompts.obterPreferenciasCache();
                const localTs = parseInt(localStorage.getItem(STORAGE_DIRECT_COPY_TS_KEY) || '0', 10);
                if (cloudPrefs && typeof cloudPrefs.directCopyEnabled === 'boolean') {
                    const cloudTs = cloudPrefs.atualizadoEm || 0;
                    if (cloudTs > localTs) {
                        directCopyEnabled = cloudPrefs.directCopyEnabled;
                        localStorage.setItem(STORAGE_DIRECT_COPY_KEY, String(directCopyEnabled));
                        localStorage.setItem(STORAGE_DIRECT_COPY_TS_KEY, String(cloudTs));
                        _syncAllDirectCopyToggles();
                    }
                }
            } else {
                console.warn("Juris Prompts [Aviso: js/firebase-prompts.js desatualizado neste painel; obterPreferenciasCache ausente].");
            }

            PromptUIController.filter();
        } catch (error) {
            console.error("Juris Prompts [Firebase Error]:", error);
            getEl('jp-list').innerHTML = `<div style="text-align: center; color: #ef4444; padding: 2rem;">Falha ao sincronizar. Verifique sua conexão.</div>`;
        }
    }

    function fecharModalPrincipal() {
        getEl('backdrop-juris-prompts').classList.remove('active');
        getEl('modal-juris-prompts').style.display = 'none';
    }

    // Helpers de Snapshot e Dirty State do Formulário
    function _getFormStateSerialized() {
        const title = (getEl('jp-title-input')?.value || '').trim();
        const content = (getEl('jp-content-input')?.value || '').trim();
        const fields = editingCustomFields
            .filter(f => (f.label || '').trim() !== '' || (f.options || '').trim() !== '' || (f.guidelines || '').trim() !== '')
            .map(f => ({
                type: f.type,
                label: (f.label || '').trim(),
                options: (f.options || '').trim(),
                guidelines: (f.guidelines || '').trim()
            }));
        return JSON.stringify({
            title,
            content,
            fields,
            subIds: [...editingSubPromptIds]
        });
    }

    function _isFormDirty() {
        if (initialFormSnapshot === null) return false;
        return _getFormStateSerialized() !== initialFormSnapshot;
    }

    // Abertura Form
    function openAddModal() {
        fecharModalPrincipal();
        getEl('jp-id').value = '';
        getEl('jp-title-input').value = '';
        getEl('jp-content-input').value = '';
        if (getEl('jp-subprompt-filter')) getEl('jp-subprompt-filter').value = '';
        getEl('jp-form-title').innerText = 'Novo Modelo';
        editingCustomFields = [];
        editingSubPromptIds = [];
        renderBuilder();
        renderSubPromptsBuilder();
        initialFormSnapshot = _getFormStateSerialized();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
        requestAnimationFrame(() => getEl('jp-title-input')?.focus());
    }

    function openEditModal(id) {
        fecharModalPrincipal();
        const p = prompts.find(x => x.id === id);
        if(!p) return;
        getEl('jp-id').value = p.id;
        getEl('jp-title-input').value = p.title;
        getEl('jp-content-input').value = p.content;
        if (getEl('jp-subprompt-filter')) getEl('jp-subprompt-filter').value = '';
        getEl('jp-form-title').innerText = 'Editar Modelo';
        editingCustomFields = p.customFields ? JSON.parse(JSON.stringify(p.customFields)) : [];
        const promptIdsSet = new Set(prompts.map(item => item.id));
        editingSubPromptIds = Array.isArray(p.subPromptIds)
            ? p.subPromptIds.filter(subId => subId !== p.id && promptIdsSet.has(subId))
            : [];
        renderBuilder();
        renderSubPromptsBuilder();
        initialFormSnapshot = _getFormStateSerialized();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
        requestAnimationFrame(() => getEl('jp-title-input')?.focus());
    }

    function closeAddModal(force = false) {
        if (!force && _isFormDirty()) {
            const confirmarDescarte = confirm('Existem alterações não salvas neste modelo. Deseja realmente descartá-las e voltar?');
            if (!confirmarDescarte) return;
        }
        initialFormSnapshot = null;
        getEl('backdrop-jp-form').classList.remove('active');
        getEl('modal-jp-form').style.display = 'none';
        restaurarModalPrincipal();
    }

    // Unifica o registro de etapa, auto-expansão da ramificação (se aplicável) e flash para prompts avulsos
    function _markStepExecuted(targetId, parentId = null, stepIdx = null) {
        const effectiveParentId = parentId || targetId;
        const parentObj = prompts.find(p => p.id === effectiveParentId);
        const hasRoutineSubs = getResolvedSubPrompts(parentObj).length > 0;

        if (stepIdx === null || stepIdx === undefined) {
            if (!hasRoutineSubs) {
                _flashStandaloneCard(effectiveParentId);
                return;
            }
            resetRoutineProgress(effectiveParentId, true);
            executedRoutineSteps.add(`${effectiveParentId}::ROOT`);
            if (!expandedBranchIds.has(effectiveParentId)) {
                toggleBranch(effectiveParentId);
            }
        } else {
            executedRoutineSteps.add(`${effectiveParentId}::${targetId}::${stepIdx}`);
        }
        _updateRoutineDOMState(effectiveParentId);
    }

    async function handleGenerate(id, event = null, parentId = null, stepIdx = null) {
        const targetPrompt = prompts.find(x => x.id === id);
        if (!targetPrompt) return;

        currentExecutionContext = { parentId: parentId || id, stepIdx };
        const forceModal = Boolean(event && event.shiftKey);
        const canDirectCopy = !hasInteractiveFields(targetPrompt) && directCopyEnabled && !forceModal;

        if (canDirectCopy) {
            try {
                await navigator.clipboard.writeText(targetPrompt.content.trim());
                _markStepExecuted(id, parentId || id, stepIdx);

                if (typeof window.exibirToast === 'function') {
                    window.exibirToast(`"${targetPrompt.title}" copiado em 1 clique!`, 'sucesso');
                }
            } catch (e) {
                console.error("Juris Prompts [Direct Clipboard Error]:", e);
                openGenModal(id);
            }
            return;
        }

        openGenModal(id);
    }

    // Abertura Gerador
    function openGenModal(id) {
        fecharModalPrincipal();
        currentActivePrompt = prompts.find(x => x.id === id);
        if(!currentActivePrompt) return;
        getEl('jp-gen-base').value = currentActivePrompt.content;
        
        const genDiv = getEl('jp-gen-dynamic');
        genDiv.innerHTML = '';
        genDiv.style.display = 'none';

        if (hasInteractiveFields(currentActivePrompt)) {
            genDiv.style.display = 'block';
            let html = `<div style="font-size:0.85rem; font-weight:bold; color: var(--theme-primary, #b48500); margin-bottom:10px;">Preencha:</div>`;
            currentActivePrompt.customFields.forEach(f => {
                html += `<div class="jp-form-group"><label>${escapeHtml(f.label)}</label>`;
                if(f.type === 'text') {
                    html += `<textarea class="jp-input jp-dyn-txt" data-label="${escapeHtml(f.label)}" style="min-height:60px;"></textarea>`;
                } else if (f.type === 'checkbox') {
                    const opts = f.options.split('\n').filter(o => o.trim() !== '');
                    html += `<div class="jp-dyn-chk-grp" data-label="${escapeHtml(f.label)}">`;
                    opts.forEach(opt => html += `<label style="display:flex; gap:8px; margin-top:5px; font-weight:normal; color:#1e293b;"><input type="checkbox" value="${escapeHtml(opt.trim())}"> ${escapeHtml(opt.trim())}</label>`);
                    html += `</div>`;
                }
                html += `</div>`;
            });
            genDiv.innerHTML = html;
        }
        getEl('backdrop-jp-gen').classList.add('active');
        getEl('modal-jp-gen').style.display = 'block';
    }

    function closeGenModal() {
        getEl('backdrop-jp-gen').classList.remove('active');
        getEl('modal-jp-gen').style.display = 'none';
        restaurarModalPrincipal();
    }

    function toggleBranch(id) {
        const p = prompts.find(x => x.id === id);
        if (!p) return;

        const validSubs = getResolvedSubPrompts(p);
        if (validSubs.length === 0) {
            if (window.exibirToast) {
                window.exibirToast('Vincule subprompts a este modelo para criar uma ramificação.', 'info');
            }
            openEditModal(id);
            return;
        }

        const isNowExpanded = !expandedBranchIds.has(id);
        if (isNowExpanded) {
            expandedBranchIds.add(id);
        } else {
            expandedBranchIds.delete(id);
        }

        const groupEl = document.querySelector(`.jp-card-group[data-prompt-id="${CSS.escape(id)}"]`);
        if (groupEl) {
            groupEl.classList.toggle('is-expanded', isNowExpanded);
            if (isNowExpanded) {
                groupEl.classList.remove('just-animated');
                void groupEl.offsetWidth;
                groupEl.classList.add('just-animated');
            }
            const branchBtn = groupEl.querySelector('.jp-icon-btn.jp-branch');
            if (branchBtn) {
                branchBtn.classList.toggle('is-active', isNowExpanded);
                branchBtn.setAttribute('aria-expanded', String(isNowExpanded));
                branchBtn.title = _buildBranchButtonTitle(validSubs.length, isNowExpanded);
            }
        } else {
            PromptUIController.filter();
        }
    }

    async function toggleDirectCopyMode(enabled) {
        directCopyEnabled = Boolean(enabled);
        const now = Date.now();
        localStorage.setItem(STORAGE_DIRECT_COPY_KEY, String(directCopyEnabled));
        localStorage.setItem(STORAGE_DIRECT_COPY_TS_KEY, String(now));
        _syncAllDirectCopyToggles();

        const modalAtivo = getEl('modal-juris-prompts');
        if (modalAtivo && modalAtivo.style.display === 'block') {
            PromptUIController.filter();
        }

        if (window.exibirToast) {
            const msg = directCopyEnabled
                ? 'Cópia 1-Click ativada para modelos sem campos extras.'
                : 'Cópia 1-Click desativada: o painel intermediário sempre abrirá.';
            window.exibirToast(msg, 'info');
        }

        if (window.FirebasePrompts && typeof window.FirebasePrompts.salvarPreferencias === 'function') {
            try {
                await window.FirebasePrompts.salvarPreferencias({ directCopyEnabled });
            } catch (e) {
                console.error("Juris Prompts [Falha ao sincronizar preferência na nuvem]:", e);
                if (window.exibirToast) {
                    window.exibirToast('Preferência salva neste navegador (sem sincronia com a nuvem no momento).', 'aviso');
                }
            }
        }
    }

    // Ações e Persistência
    async function savePrompt() {
        if (isSyncing) return;
        if (!verificarSessao()) return;

        const id = getEl('jp-id').value;
        const title = getEl('jp-title-input').value.trim();
        const content = getEl('jp-content-input').value.trim();
        if(!title || !content) { alert('Preencha nome e teor.'); return; }
        
        const validFields = editingCustomFields.filter(f => f.label.trim() !== '');
        const existingPrompt = id ? prompts.find(p => p.id === id) : null;
        const validSubIds = editingSubPromptIds.filter(subId => subId !== id && prompts.some(p => p.id === subId));
        
        const promptObj = { 
            title, 
            content, 
            customFields: validFields,
            subPromptIds: validSubIds,
            favorite: existingPrompt ? Boolean(existingPrompt.favorite) : false
        };
        if (id) promptObj.id = id;

        try {
            isSyncing = true;
            document.body.style.cursor = 'wait';
            
            const idGerado = await window.FirebasePrompts.salvar(promptObj);
            const finalId = id || idGerado;
            
            if (id) {
                const idx = prompts.findIndex(p => p.id === id);
                if (idx !== -1) prompts[idx] = { ...prompts[idx], ...promptObj, id };
            } else {
                prompts.push({ ...promptObj, id: idGerado });
            }

            if (validSubIds.length > 0) {
                expandedBranchIds.add(finalId);
            }

            closeAddModal(true);
            if (window.exibirToast) window.exibirToast('Salvo na nuvem com sucesso!', 'sucesso');
            
        } catch (error) {
            console.error("Erro ao salvar:", error);
            if (window.exibirToast) window.exibirToast('Erro crítico ao salvar. Tente novamente.', 'erro');
        } finally {
            isSyncing = false;
            document.body.style.cursor = 'default';
        }
    }

    async function toggleFavorite(id) {
        if (isSyncing || !verificarSessao()) return;

        const idx = prompts.findIndex(p => p.id === id);
        if (idx === -1) return;

        const estadoAnterior = Boolean(prompts[idx].favorite);
        const novoEstado = !estadoAnterior;
        prompts[idx].favorite = novoEstado;

        PromptUIController.filter();

        try {
            isSyncing = true;
            if (typeof window.FirebasePrompts.atualizarCampos === 'function') {
                await window.FirebasePrompts.atualizarCampos(id, { favorite: novoEstado });
            } else {
                console.warn("Juris Prompts [Aviso: js/firebase-prompts.js desatualizado neste painel; usando fallback salvar()].");
                await window.FirebasePrompts.salvar(prompts[idx]);
            }
        } catch (error) {
            console.error("Erro ao favoritar modelo:", error);
            prompts[idx].favorite = estadoAnterior;
            PromptUIController.filter();
            if (window.exibirToast) window.exibirToast('Falha ao atualizar favorito na nuvem.', 'erro');
        } finally {
            isSyncing = false;
        }
    }

    async function deletePrompt(id) {
        if (isSyncing || !verificarSessao()) return;

        const targetPrompt = prompts.find(p => p.id === id);
        if (!targetPrompt) return;

        const parentRoutines = getParentRoutinesUsing(id);
        let msgConfirm = `Excluir o modelo "${targetPrompt.title}" da nuvem definitivamente?`;

        if (parentRoutines.length > 0) {
            const listaNomes = parentRoutines.map(r => `• ${r.title}`).join('\n');
            msgConfirm = `⚠️ ATENÇÃO — SUBPROMPT COMPARTILHADO\n\n` +
                         `O modelo "${targetPrompt.title}" faz parte da ramificação de ${parentRoutines.length} rotina(s):\n` +
                         `${listaNomes}\n\n` +
                         `Se você excluí-lo, ele será removido permanentemente da nuvem e de todas essas rotinas.\n` +
                         `(Dica: Para apenas tirá-lo de uma rotina sem apagá-lo, clique em Editar no prompt principal).\n\n` +
                         `Deseja confirmar a exclusão definitiva?`;
        }

        if (confirm(msgConfirm)) {
            try {
                isSyncing = true;
                await window.FirebasePrompts.excluir(id);
                
                prompts = prompts.filter(p => p.id !== id);
                expandedBranchIds.delete(id);

                const parentUpdates = [];
                parentRoutines.forEach(parent => {
                    parent.subPromptIds = parent.subPromptIds.filter(subId => subId !== id);
                    if (typeof window.FirebasePrompts.removerReferenciaSubPrompt === 'function') {
                        parentUpdates.push(window.FirebasePrompts.removerReferenciaSubPrompt(parent.id, id));
                    } else if (typeof window.FirebasePrompts.atualizarCampos === 'function') {
                        console.warn("Juris Prompts [Aviso: removerReferenciaSubPrompt ausente; usando fallback atualizarCampos].");
                        parentUpdates.push(window.FirebasePrompts.atualizarCampos(parent.id, { subPromptIds: parent.subPromptIds }));
                    } else {
                        console.warn("Juris Prompts [Aviso: js/firebase-prompts.js desatualizado neste painel; atualize-o para persistir a limpeza dos pais].");
                    }
                });

                if (parentUpdates.length > 0) {
                    const results = await Promise.allSettled(parentUpdates);
                    results.forEach((res, idx) => {
                        if (res.status === 'rejected') {
                            console.warn(`Juris Prompts [Aviso: falha ao limpar subprompt órfão no pai ${parentRoutines[idx]?.id}]:`, res.reason);
                        }
                    });
                }

                PromptUIController.filter();
                if (window.exibirToast) window.exibirToast('Modelo excluído!', 'sucesso');
            } catch (error) {
                console.error("Juris Prompts [Erro ao excluir modelo]:", error);
                if (window.exibirToast) window.exibirToast('Falha ao excluir.', 'erro');
            } finally {
                isSyncing = false;
            }
        }
    }

    async function copyToClipboard() {
        let final = currentActivePrompt.content.trim() + "\n\n";
        
        if (hasInteractiveFields(currentActivePrompt)) {
            let extrasText = "--- INSTRUÇÕES ADICIONAIS / CONTEXTO DA PEÇA ---\n\n";
            
            currentActivePrompt.customFields.forEach(f => {
                extrasText += `### ${f.label} ###\n`;
                
                if (f.type === 'text') {
                    const inp = document.querySelector(`.jp-dyn-txt[data-label="${CSS.escape(f.label)}"]`);
                    const valor = inp ? inp.value.trim() : '';
                    
                    if (valor !== '') {
                        extrasText += `${valor}\n\n`;
                    } else {
                        extrasText += `[Atenção IA: Nenhuma informação foi fornecida pelo usuário para este tópico. Não presuma dados.]\n\n`;
                    }
                } 
                else if (f.type === 'checkbox') {
                    const grp = document.querySelector(`.jp-dyn-chk-grp[data-label="${CSS.escape(f.label)}"]`);
                    if (grp) {
                        const checks = grp.querySelectorAll('input:checked');
                        if (checks.length > 0) {
                            if (f.guidelines && f.guidelines.trim() !== '') {
                                extrasText += `[Diretriz Específicas]: ${f.guidelines.trim()}\n\n`;
                            }
                            checks.forEach(c => extrasText += `- ${c.value}\n`);
                            extrasText += `\n`;
                        } else {
                            extrasText += `[Atenção IA: Nenhuma das opções predefinidas foi selecionada.]\n\n`;
                        }
                    }
                }
            });
            
            final += extrasText;
        }
        
        try {
            await navigator.clipboard.writeText(final.trim());
            const copiedId = currentActivePrompt.id;
            const ctxParentId = currentExecutionContext.parentId || copiedId;
            const ctxStepIdx = currentExecutionContext.stepIdx;

            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Prompt estruturado e copiado com sucesso!', 'sucesso');
            } else {
                alert('Modelo estruturado copiado para a área de transferência!');
            }
            closeGenModal();
            // Registra a etapa e auto-expande a ramificação caso seja um prompt principal com subprompts
            _markStepExecuted(copiedId, ctxParentId, ctxStepIdx);
        } catch(e) { 
            console.error("Juris Prompts [Clipboard Error]:", e);
            alert('Falha ao acessar a área de transferência. Verifique as permissões de segurança do navegador.'); 
        }
    }

    // Delegação de Eventos Global para a Barra de Pesquisa e Filtro de Subprompts
    document.addEventListener('input', (e) => {
        if (!e.target) return;
        if (e.target.id === 'jp-search') {
            const btnClear = document.getElementById('jp-btn-clear-search');
            if (btnClear) {
                btnClear.style.display = e.target.value.length > 0 ? 'flex' : 'none';
            }
            PromptUIController.filter();
        } else if (e.target.id === 'jp-subprompt-filter') {
            renderSubPromptsBuilder();
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target && e.target.matches('[data-jp-direct-toggle="true"]')) {
            toggleDirectCopyMode(e.target.checked);
        }
    });

    // Controle de UX avançada (Tecla ESC)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modalAtivo = document.getElementById('modal-juris-prompts');
            const isModalOpen = modalAtivo && modalAtivo.style.display === 'block';
            
            if (isModalOpen) {
                const searchInput = getEl('jp-search');
                if (document.activeElement === searchInput && searchInput.value !== '') {
                    e.preventDefault();
                    PromptUIController.clearSearch();
                }
            }
        }
    });

    _syncAllDirectCopyToggles();
    document.addEventListener('DOMContentLoaded', _syncAllDirectCopyToggles);

    return {
        abrirModal,
        fecharModalPrincipal,
        filter: () => {
            const searchEl = getEl('jp-search');
            const rawTerm = searchEl ? searchEl.value : '';
            const normTerm = normalizeText(rawTerm);

            // Sem termo de busca: exibe Favoritos no topo + Ordem Alfabética Limpa
            if (!normTerm) {
                renderList();
                return;
            }

            // Com termo de busca:
            // Prioridade 1 -> Termo contido no Nome (title)
            // Prioridade 2 -> Termo contido apenas no Conteúdo (content)
            const titleMatches = [];
            const contentMatches = [];
            const contentMatchIds = new Set();

            prompts.forEach(p => {
                const inTitle = normalizeText(p.title).includes(normTerm);
                if (inTitle) {
                    titleMatches.push(p);
                } else if (normalizeText(p.content).includes(normTerm)) {
                    contentMatches.push(p);
                    contentMatchIds.add(p.id);
                }
            });

            const combinedResults = [
                ...getDefaultSortedPrompts(titleMatches),
                ...getDefaultSortedPrompts(contentMatches)
            ];

            renderList(combinedResults, contentMatchIds);
        },
        clearSearch: () => {
            const searchInput = getEl('jp-search');
            const btnClear = document.getElementById('jp-btn-clear-search');
            
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            if (btnClear) btnClear.style.display = 'none';
            
            PromptUIController.filter();
        },
        openAddModal,
        closeAddModal,
        openEditModal,
        openGenModal,
        handleGenerate,
        closeGenModal,
        toggleBranch,
        toggleDirectCopyMode,
        resetRoutineProgress,
        addField: (t) => { editingCustomFields.push({type: t, label: '', options: '', guidelines: ''}); renderBuilder(); },
        updField: (idx, k, v) => { editingCustomFields[idx][k] = v; },
        rmField: (idx) => { editingCustomFields.splice(idx, 1); renderBuilder(); },
        addSubPromptFromSelect: () => {
            const selectEl = getEl('jp-subprompt-select');
            if (!selectEl || !selectEl.value) return;
            if (!editingSubPromptIds.includes(selectEl.value)) {
                editingSubPromptIds.push(selectEl.value);
                renderSubPromptsBuilder();
            }
        },
        moveSubPrompt: (idx, dir) => {
            const targetIdx = idx + dir;
            if (targetIdx < 0 || targetIdx >= editingSubPromptIds.length) return;
            const temp = editingSubPromptIds[idx];
            editingSubPromptIds[idx] = editingSubPromptIds[targetIdx];
            editingSubPromptIds[targetIdx] = temp;
            renderSubPromptsBuilder();
        },
        rmSubPrompt: (idx) => {
            editingSubPromptIds.splice(idx, 1);
            renderSubPromptsBuilder();
        },
        savePrompt,
        toggleFavorite,
        deletePrompt,
        copyToClipboard
    };
})();