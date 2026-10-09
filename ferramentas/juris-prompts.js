window.PromptUIController = (function() {
    let prompts = [];
    let currentActivePrompt = null;
    let editingCustomFields = [];
    let isSyncing = false; // Semáforo de concorrência

    const getEl = (id) => document.getElementById(id);

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

    function renderList(data = prompts) {
        const list = getEl('jp-list');
        list.innerHTML = '';
        if (data.length === 0) {
            list.innerHTML = `<div style="text-align: center; color: #64748b; padding: 2rem; border: 1px dashed #cbd5e0; border-radius: 8px;">Nenhum modelo encontrado.</div>`;
            return;
        }

        data.forEach(p => {
            const hasExtras = p.customFields && p.customFields.length > 0;
            const badge = hasExtras ? `<span style="background: var(--semantic-info-bg, #e0f2fe); color: var(--semantic-info-text, #0369a1); padding: 2px 6px; border-radius:4px; font-size:0.7rem; margin-left:8px;">+${p.customFields.length} extras</span>` : '';
            
            const card = document.createElement('div');
            card.className = 'jp-card';
            card.innerHTML = `
                <div class="jp-card-info">
                    <div class="jp-title">${p.title} ${badge}</div>
                    <div class="jp-preview">${p.content.substring(0, 70)}...</div>
                </div>
                <div class="jp-actions">
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
                <input type="text" class="jp-input" placeholder="Título do Campo" value="${field.label}" onchange="PromptUIController.updField(${index}, 'label', this.value)" required>
                ${spec}
            `;
            c.appendChild(card);
        });
    }

    // Abertura Modal Principal com Auth Guard e Caching
    async function abrirModal() {
        if (!verificarSessao()) return;

        getEl('backdrop-juris-prompts').classList.add('active');
        getEl('modal-juris-prompts').style.display = 'block';
        
        getEl('jp-list').innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b;">⏳ Sincronizando com a nuvem...</div>`;
        
        try {
            if (!window.FirebasePrompts) throw new Error("Módulo de nuvem não carregado.");
            // Fetch limpo. Só ocorre na abertura.
            prompts = await window.FirebasePrompts.carregar();
            renderList();
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
        abrirModal();
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
                html += `<div class="jp-form-group"><label>${f.label}</label>`;
                if(f.type === 'text') {
                    html += `<textarea class="jp-input jp-dyn-txt" data-label="${f.label}" style="min-height:60px;"></textarea>`;
                } else if (f.type === 'checkbox') {
                    const opts = f.options.split('\n').filter(o => o.trim() !== '');
                    html += `<div class="jp-dyn-chk-grp" data-label="${f.label}">`;
                    opts.forEach(opt => html += `<label style="display:flex; gap:8px; margin-top:5px; font-weight:normal; color:#1e293b;"><input type="checkbox" value="${opt.trim()}"> ${opt.trim()}</label>`);
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
        abrirModal();
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
        const promptObj = { title, content, customFields: validFields };
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

            closeAddModal();
            renderList();
            if (window.exibirToast) window.exibirToast('Salvo na nuvem com sucesso!', 'sucesso');
            
        } catch (error) {
            console.error("Erro ao salvar:", error);
            if (window.exibirToast) window.exibirToast('Erro crítico ao salvar. Tente novamente.', 'erro');
        } finally {
            isSyncing = false;
            document.body.style.cursor = 'default';
        }
    }

    async function deletePrompt(id) {
        if (isSyncing || !verificarSessao()) return;

        if(confirm('Excluir este modelo da nuvem definitivamente?')) {
            try {
                isSyncing = true;
                await window.FirebasePrompts.excluir(id);
                
                // OPTIMISTIC UPDATE: Filtra da memória, sem ler o DB de novo
                prompts = prompts.filter(p => p.id !== id);
                renderList();
                
                if (window.exibirToast) window.exibirToast('Modelo excluído!', 'sucesso');
            } catch (error) {
                if (window.exibirToast) window.exibirToast('Falha ao excluir.', 'erro');
            } finally {
                isSyncing = false;
            }
        }
    }

    async function copyToClipboard() {
        // 1. Injeção do Teor Base do Prompt (sempre garantido)
        let final = currentActivePrompt.content.trim() + "\n\n";
        
        // 2. Avaliação de Contexto Dinâmico Baseada em Schema (Data-Driven)
        if (currentActivePrompt.customFields && currentActivePrompt.customFields.length > 0) {
            let extrasText = "--- INSTRUÇÕES ADICIONAIS / CONTEXTO DA PEÇA ---\n\n";
            
            // Iteração rigorosa sobre os campos planejados no modelo
            currentActivePrompt.customFields.forEach(f => {
                extrasText += `### ${f.label} ###\n`;
                
                if (f.type === 'text') {
                    const inp = document.querySelector(`.jp-dyn-txt[data-label="${f.label}"]`);
                    const valor = inp ? inp.value.trim() : '';
                    
                    if (valor !== '') {
                        extrasText += `${valor}\n\n`;
                    } else {
                        // Prevenção de Alucinação (Negative Prompt)
                        extrasText += `[Atenção IA: Nenhuma informação foi fornecida pelo usuário para este tópico. Não presuma dados.]\n\n`;
                    }
                } 
                else if (f.type === 'checkbox') {
                    const grp = document.querySelector(`.jp-dyn-chk-grp[data-label="${f.label}"]`);
                    if (grp) {
                        const checks = grp.querySelectorAll('input:checked');
                        if (checks.length > 0) {
                            // [NOVO] Injeção Condicional de Diretrizes Específicas
                            if (f.guidelines && f.guidelines.trim() !== '') {
                                extrasText += `[Diretriz Específica]: ${f.guidelines.trim()}\n\n`;
                            }
                            
                            // Lista as opções que o usuário marcou
                            checks.forEach(c => extrasText += `- ${c.value}\n`);
                            extrasText += `\n`;
                        } else {
                            // Prevenção de Alucinação para Arrays/Múltipla Escolha
                            extrasText += `[Atenção IA: Nenhuma das opções predefinidas foi selecionada.]\n\n`;
                        }
                    }
                }
            });
            
            // Acoplamento do contexto dinâmico ao payload final
            final += extrasText;
        }
        
        // 3. Execução Segura via API Assíncrona
        try {
            await navigator.clipboard.writeText(final.trim());
            // Interface com sistema de Toast global do Juris Core
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

    // --- NOVO: Delegação de Eventos Global ---
    // Garante que o filtro funcione mesmo com o HTML sendo injetado dinamicamente
    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'jp-search') {
            const btnClear = document.getElementById('jp-btn-clear-search');
            if (btnClear) {
                // Reatividade leve baseada no tamanho da string
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
                // Se o foco está no input e tem texto, apenas limpa. 
                // Do contrário, deixa fluir (poderá fechar o modal).
                if (document.activeElement === searchInput && searchInput.value !== '') {
                    e.preventDefault();
                    PromptUIController.clearSearch();
                }
            }
        }
    });

    return {
        abrirModal, fecharModalPrincipal, filter: () => {
            const term = getEl('jp-search').value.toLowerCase();
            renderList(prompts.filter(p => p.title.toLowerCase().includes(term) || p.content.toLowerCase().includes(term)));
        },
        clearSearch: () => {
            const searchInput = getEl('jp-search');
            const btnClear = document.getElementById('jp-btn-clear-search');
            
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus(); // Mantém contexto para o usuário continuar navegando
            }
            if (btnClear) btnClear.style.display = 'none';
            
            PromptUIController.filter(); // Recarrega a lista original
        },
        openAddModal, closeAddModal, openEditModal, openGenModal, closeGenModal,
        addField: (t) => { editingCustomFields.push({type: t, label: '', options: '', guidelines: ''}); renderBuilder(); },
        updField: (idx, k, v) => { editingCustomFields[idx][k] = v; },
        rmField: (idx) => { editingCustomFields.splice(idx,1); renderBuilder(); },
        savePrompt, deletePrompt, copyToClipboard
    };
})();