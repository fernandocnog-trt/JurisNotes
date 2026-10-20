window.PromptUIController = (function() {
    let prompts = [];
    let currentActivePrompt = null;
    let editingCustomFields = [];
    let isSyncing = false; // Semáforo de concorrência

    const getEl = (id) => document.getElementById(id);

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
            const hasExtras = p.customFields && p.customFields.length > 0;
            const badgeExtras = hasExtras 
                ? `<span class="jp-badge-extras">+${p.customFields.length} extras</span>` 
                : '';
            
            // Exibe indicador se o item apareceu na busca exclusivamente pelo conteúdo interno
            const isContentMatch = contentMatchIds && contentMatchIds.has(p.id);
            const badgeMatch = isContentMatch 
                ? `<span class="jp-badge-match" title="O termo pesquisado foi encontrado no teor deste prompt">Contém no texto</span>` 
                : '';

            const isFav = Boolean(p.favorite);
            const favClass = isFav ? 'is-fav' : '';
            const favTitle = isFav ? 'Remover dos favoritos' : 'Favoritar modelo';
            
            const card = document.createElement('div');
            card.className = 'jp-card';
            card.innerHTML = `
                <div class="jp-card-info">
                    <div class="jp-title">
                        <span class="jp-title-text" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>
                        ${badgeExtras}
                        ${badgeMatch}
                    </div>
                </div>
                <div class="jp-actions">
                    <button class="jp-icon-btn jp-fav ${favClass}" aria-pressed="${isFav}" onclick="PromptUIController.toggleFavorite('${p.id}')" title="${favTitle}">
                        <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    </button>
                    <button class="jp-icon-btn jp-play" onclick="PromptUIController.openGenModal('${p.id}')" title="Gerar"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
                    <button class="jp-icon-btn jp-edit" onclick="PromptUIController.openEditModal('${p.id}')" title="Editar"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="jp-icon-btn jp-del" onclick="PromptUIController.deletePrompt('${p.id}')" title="Excluir"><svg viewBox="0 0 24 24" style="stroke: var(--semantic-danger, #ef4444);"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
            list.appendChild(card);
        });
    }

    function renderBuilder() {
        const c = getEl('jp-builder-container');
        c.innerHTML = '';
        editingCustomFields.forEach((field, index) => {
            const card = document.createElement('div');
            card.className = 'jp-field-card';
            let spec = '';
            if (field.type === 'checkbox') {
                spec = `
                    <label style="font-size:0.8rem; margin-top:8px; display:block; color: #475569;">Opções (uma por linha):</label>
                    <textarea class="jp-input" style="min-height:60px; padding:0.5rem;" onchange="PromptUIController.updField(${index}, 'options', this.value)" required>${field.options || ''}</textarea>
                    
                    <label style="font-size:0.8rem; margin-top:8px; display:block; color: #475569;">Diretrizes Específicas p/ IA (Opcional):</label>
                    <textarea class="jp-input" style="min-height:45px; padding:0.5rem; background-color: #f8fafc;" placeholder="Ex: Liste as escolhas em formato de bullet points curtos..." onchange="PromptUIController.updField(${index}, 'guidelines', this.value)">${field.guidelines || ''}</textarea>
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

    // Restaura a visualização do Modal Principal usando o cache local (sem novo fetch na nuvem)
    function restaurarModalPrincipal() {
        getEl('backdrop-juris-prompts').classList.add('active');
        getEl('modal-juris-prompts').style.display = 'block';
        PromptUIController.filter();
    }

    // Abertura Modal Principal com Auth Guard e Fetch Inicial
    async function abrirModal() {
        if (!verificarSessao()) return;

        getEl('backdrop-juris-prompts').classList.add('active');
        getEl('modal-juris-prompts').style.display = 'block';
        
        getEl('jp-list').innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b;">⏳ Sincronizando com a nuvem...</div>`;
        
        try {
            if (!window.FirebasePrompts) throw new Error("Módulo de nuvem não carregado.");
            prompts = await window.FirebasePrompts.carregar();
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

    // Abertura Form
    function openAddModal() {
        fecharModalPrincipal();
        getEl('jp-id').value = '';
        getEl('jp-title-input').value = '';
        getEl('jp-content-input').value = '';
        getEl('jp-form-title').innerText = 'Novo Modelo';
        editingCustomFields = [];
        renderBuilder();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
    }

    function openEditModal(id) {
        fecharModalPrincipal();
        const p = prompts.find(x => x.id === id);
        if(!p) return;
        getEl('jp-id').value = p.id;
        getEl('jp-title-input').value = p.title;
        getEl('jp-content-input').value = p.content;
        getEl('jp-form-title').innerText = 'Editar Modelo';
        editingCustomFields = p.customFields ? JSON.parse(JSON.stringify(p.customFields)) : [];
        renderBuilder();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
    }

    function closeAddModal() {
        getEl('backdrop-jp-form').classList.remove('active');
        getEl('modal-jp-form').style.display = 'none';
        restaurarModalPrincipal();
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

        if (currentActivePrompt.customFields && currentActivePrompt.customFields.length > 0) {
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
        
        const promptObj = { 
            title, 
            content, 
            customFields: validFields,
            favorite: existingPrompt ? Boolean(existingPrompt.favorite) : false
        };
        if (id) promptObj.id = id;

        try {
            isSyncing = true;
            document.body.style.cursor = 'wait';
            
            // Grava na nuvem
            const idGerado = await window.FirebasePrompts.salvar(promptObj);
            
            // OPTIMISTIC CACHE UPDATE: Modifica apenas o array local (O(1))
            if (id) {
                const idx = prompts.findIndex(p => p.id === id);
                if (idx !== -1) prompts[idx] = { ...promptObj, id };
            } else {
                prompts.push({ ...promptObj, id: idGerado });
            }

            // closeAddModal() já restaura o modal principal e aplica filter() sobre o array atualizado
            closeAddModal();
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
        prompts[idx].favorite = !estadoAnterior;

        // Optimistic UI: Reordena e atualiza a estrela imediatamente
        PromptUIController.filter();

        try {
            isSyncing = true;
            await window.FirebasePrompts.salvar(prompts[idx]);
        } catch (error) {
            console.error("Erro ao favoritar modelo:", error);
            // Rollback em caso de erro de rede/permissão
            prompts[idx].favorite = estadoAnterior;
            PromptUIController.filter();
            if (window.exibirToast) window.exibirToast('Falha ao atualizar favorito na nuvem.', 'erro');
        } finally {
            isSyncing = false;
        }
    }

    async function deletePrompt(id) {
        if (isSyncing || !verificarSessao()) return;

        if(confirm('Excluir este modelo da nuvem definitivamente?')) {
            try {
                isSyncing = true;
                await window.FirebasePrompts.excluir(id);
                
                // OPTIMISTIC UPDATE: Filtra da memória e preserva filtro atual
                prompts = prompts.filter(p => p.id !== id);
                PromptUIController.filter();
                
                if (window.exibirToast) window.exibirToast('Modelo excluído!', 'sucesso');
            } catch (error) {
                if (window.exibirToast) window.exibirToast('Falha ao excluir.', 'erro');
            } finally {
                isSyncing = false;
            }
        }
    }

    async function copyToClipboard() {
        let final = currentActivePrompt.content.trim() + "\n\n";
        
        if (currentActivePrompt.customFields && currentActivePrompt.customFields.length > 0) {
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
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Prompt estruturado e copiado com sucesso!', 'sucesso');
            } else {
                alert('Modelo estruturado copiado para a área de transferência!');
            }
            closeGenModal();
        } catch(e) { 
            console.error("Juris Prompts [Clipboard Error]:", e);
            alert('Falha ao acessar a área de transferência. Verifique as permissões de segurança do navegador.'); 
        }
    }

    // Delegação de Eventos Global para a Barra de Pesquisa
    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'jp-search') {
            const btnClear = document.getElementById('jp-btn-clear-search');
            if (btnClear) {
                btnClear.style.display = e.target.value.length > 0 ? 'flex' : 'none';
            }
            PromptUIController.filter();
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
        closeGenModal,
        addField: (t) => { editingCustomFields.push({type: t, label: '', options: '', guidelines: ''}); renderBuilder(); },
        updField: (idx, k, v) => { editingCustomFields[idx][k] = v; },
        rmField: (idx) => { editingCustomFields.splice(idx, 1); renderBuilder(); },
        savePrompt,
        toggleFavorite,
        deletePrompt,
        copyToClipboard
    };
})();