window.PromptUIController = (function() {
    let prompts = [];
    let currentActivePrompt = null;
    let currentExecutionContext = { parentId: null, stepIdx: null };
    let editingKind = 'modelo';         // 'modelo' | 'bloco'
    let editingInlineSlots = [];        // [{ id, label, defaultMode, candidateSubPromptIds }]
    let editingCustomFields = [];
    let editingSubPromptIds = [];
    let slotGraveyard = new Map();      // Preserva configs durante a sessão para Ctrl+Z e Ctrl+X/V
    let lastSavedRange = null;
    let initialFormSnapshot = null;
    let expandedBranchIds = new Set();
    
    // Estado de execução exclusivo para rotinas com ramificação: "${parentId}::ROOT" e "${parentId}::${subId}::${stepIdx}"
    let executedRoutineSteps = new Set();
    let isSyncing = false; // Semáforo de concorrência

    const STORAGE_DIRECT_COPY_KEY = 'juris_prompts_direct_copy';
    const STORAGE_DIRECT_COPY_TS_KEY = 'juris_prompts_direct_copy_ts';
    let directCopyEnabled = localStorage.getItem(STORAGE_DIRECT_COPY_KEY) !== 'false';

    const STORAGE_HIDE_BLOCKS_KEY = 'juris_prompts_hide_blocks';
    let hideBlocksInList = localStorage.getItem(STORAGE_HIDE_BLOCKS_KEY) === 'true';

    const SLOT_TOKEN_RE = /\{\{SLOT:([A-Za-z0-9_-]+)\}\}/g;
    const BLOCK_TAGS = new Set(['DIV', 'P', 'LI']);
    const CLIPBOARD_MIME_JURIS = 'application/x-juris-prompt';

    const getEl = (id) => document.getElementById(id);

    function _syncAllDirectCopyToggles() {
        document.querySelectorAll('[data-jp-direct-toggle="true"]').forEach(chk => {
            chk.checked = directCopyEnabled;
        });
    }

    function _syncHideBlocksToggle() {
        const chk = getEl('jp-hide-blocks-toggle');
        if (chk) chk.checked = hideBlocksInList;
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

    function tokenizeTemplate(raw = '') {
        const text = String(raw);
        const parts = [];
        let last = 0;
        for (const m of text.matchAll(SLOT_TOKEN_RE)) {
            if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
            parts.push({ type: 'slot', id: m[1] });
            last = m.index + m[0].length;
        }
        if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
        return parts;
    }

    function stripSlotTokens(raw = '') {
        return String(raw).replace(SLOT_TOKEN_RE, '');
    }

    function getPromptKind(promptObj) {
        return promptObj?.kind === 'bloco' ? 'bloco' : 'modelo';
    }

    function getInteractiveCounts(promptObj) {
        return {
            inlineCount: Array.isArray(promptObj?.inlineSlots) ? promptObj.inlineSlots.length : 0,
            extraCount: Array.isArray(promptObj?.customFields) ? promptObj.customFields.length : 0
        };
    }

    function hasInteractiveFields(promptObj) {
        const { inlineCount, extraCount } = getInteractiveCounts(promptObj);
        return (inlineCount + extraCount) > 0;
    }

    function getPromptsUsingInInlineSlots(targetId) {
        return prompts.filter(p =>
            p.id !== targetId &&
            Array.isArray(p.inlineSlots) &&
            p.inlineSlots.some(s => Array.isArray(s.candidateSubPromptIds) && s.candidateSubPromptIds.includes(targetId))
        );
    }

    function _buildInteractiveBadgesHtml(promptObj) {
        const { inlineCount, extraCount } = getInteractiveCounts(promptObj);
        let html = '';
        if (getPromptKind(promptObj) === 'bloco') {
            html += `<span class="jp-badge-block" title="Bloco modular de preenchimento">🧩 Bloco</span>`;
        }
        if (inlineCount > 0) {
            html += `<span class="jp-badge-slots" title="${inlineCount} formulário(s) posicionado(s) no texto">${inlineCount} no texto</span>`;
        }
        if (extraCount > 0) {
            html += `<span class="jp-badge-extras" title="${extraCount} campo(s) extra(s) ao final">+${extraCount} final</span>`;
        }
        return html;
    }

    function _buildSlotChipHtml(slot, index) {
        const label = slot.label || `Formulário ${index + 1}`;
        const title = `Formulário inline: ${slot.label || 'Sem nome'} (Clique para configurar)`;
        return `<span class="jp-slot-chip" contenteditable="false" data-slot-id="${escapeHtml(slot.id)}" title="${escapeHtml(title)}">` +
            `<span class="jp-slot-chip__badge">${index + 1}</span>` +
            `<span class="jp-slot-chip__label">${escapeHtml(label)}</span>` +
            `<span class="jp-slot-chip__remove" data-remove-slot="${escapeHtml(slot.id)}" title="Remover este formulário">×</span>` +
            `</span>`;
    }

    function _createSlotChipElement(slot, index) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = _buildSlotChipHtml(slot, index);
        return wrapper.firstElementChild;
    }

    function _normalizeRangeOutsideChips(range) {
        if (!range) return range;
        const container = range.startContainer;
        const el = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
        const hostChip = el?.closest?.('.jp-slot-chip');
        if (hostChip) {
            range.setStartAfter(hostChip);
            range.collapse(true);
        }
        return range;
    }

    // Insere HTML no editor integrando-se à pilha nativa de Ctrl+Z (com fallback DOM seguro)
    function _insertHtmlWithUndo(html, verifySlotId, fallbackDomFn) {
        const editor = getEl('jp-content-editor');
        let ok = false;
        try {
            ok = document.execCommand('insertHTML', false, html);
        } catch (_) {
            ok = false;
        }

        if (ok && verifySlotId && editor) {
            const inserted = editor.querySelector(`.jp-slot-chip[data-slot-id="${CSS.escape(verifySlotId)}"]`);
            if (inserted) {
                inserted.setAttribute('contenteditable', 'false');
                return true;
            }
            ok = false;
        }

        if (!ok && typeof fallbackDomFn === 'function') {
            fallbackDomFn();
        }
        return ok;
    }

    function _serializeNodes(rootNode, readableForExternal = false) {
        const slotMap = readableForExternal
            ? new Map(editingInlineSlots.map((s, i) => [s.id, s.label || `Formulário ${i + 1}`]))
            : null;
        let out = '';

        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                out += node.nodeValue
                    .replace(/\u200B/g, '')
                    .replace(/\u00A0/g, ' ')
                    .replace(/\r\n?/g, '\n');
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.dataset && node.dataset.jpSentinel === 'true') return;
            if (node.classList.contains('jp-slot-chip')) {
                const id = node.dataset.slotId;
                out += readableForExternal ? `[${slotMap.get(id) || 'Formulário'}]` : `{{SLOT:${id}}}`;
                return;
            }
            if (node.tagName === 'BR') {
                out += '\n';
                return;
            }
            const isBlock = BLOCK_TAGS.has(node.tagName);
            if (isBlock && out.length > 0 && !out.endsWith('\n')) out += '\n';
            node.childNodes.forEach(walk);
            if (isBlock && !out.endsWith('\n')) out += '\n';
        };

        rootNode.childNodes.forEach(walk);
        return out.replace(/\n$/, '');
    }

    function serializePromptEditor() {
        const editor = getEl('jp-content-editor');
        if (!editor) return '';
        return _serializeNodes(editor, false);
    }

    function _appendTextWithBr(fragment, text) {
        const normalized = String(text).replace(/\r\n?/g, '\n');
        const lines = normalized.split('\n');
        lines.forEach((line, i) => {
            if (line.length > 0) fragment.appendChild(document.createTextNode(line));
            if (i < lines.length - 1) fragment.appendChild(document.createElement('br'));
        });
    }

    function hydratePromptEditor(rawContent = '', slots = []) {
        const editor = getEl('jp-content-editor');
        if (!editor) return;
        editor.innerHTML = '';

        const normalized = String(rawContent || '').replace(/\r\n?/g, '\n');
        const slotMap = new Map(slots.map((s, idx) => [s.id, { slot: s, idx }]));
        const frag = document.createDocumentFragment();

        tokenizeTemplate(normalized).forEach(part => {
            if (part.type === 'text') {
                _appendTextWithBr(frag, part.value);
            } else {
                const entry = slotMap.get(part.id);
                if (entry) frag.appendChild(_createSlotChipElement(entry.slot, entry.idx));
            }
        });

        if (normalized.endsWith('\n')) {
            const sentinel = document.createElement('br');
            sentinel.dataset.jpSentinel = 'true';
            frag.appendChild(sentinel);
        }

        editor.appendChild(frag);
    }

    function _refreshChipsVisualInEditor() {
        const editor = getEl('jp-content-editor');
        if (!editor) return;
        const slotMap = new Map(editingInlineSlots.map((s, idx) => [s.id, { slot: s, idx }]));
        editor.querySelectorAll('.jp-slot-chip').forEach(chip => {
            const entry = slotMap.get(chip.dataset.slotId);
            if (!entry) { chip.remove(); return; }
            const badge = chip.querySelector('.jp-slot-chip__badge');
            const label = chip.querySelector('.jp-slot-chip__label');
            if (badge) badge.textContent = String(entry.idx + 1);
            if (label) label.textContent = entry.slot.label || `Formulário ${entry.idx + 1}`;
        });
    }

    function _reconcileSlotsWithEditor(forceRender = false) {
        const editor = getEl('jp-content-editor');
        if (!editor) return;

        const prevSig = editingInlineSlots.map(s => s.id).join('|');
        const known = new Map([
            ...slotGraveyard.entries(),
            ...editingInlineSlots.map(s => [s.id, s])
        ]);

        const seen = new Set();
        const ordered = [];
        let domWasMutated = false;

        editor.querySelectorAll('.jp-slot-chip').forEach(chip => {
            const id = chip.dataset.slotId;
            const cfg = known.get(id);
            if (seen.has(id) || !cfg) {
                chip.remove();
                domWasMutated = true;
                return;
            }
            seen.add(id);
            ordered.push(cfg);
            slotGraveyard.delete(id);
        });

        editingInlineSlots.forEach(s => {
            if (!seen.has(s.id)) slotGraveyard.set(s.id, s);
        });

        const nextSig = ordered.map(s => s.id).join('|');
        if (!forceRender && !domWasMutated && prevSig === nextSig) {
            return; // Preserva os <details> abertos durante digitação comum
        }

        editingInlineSlots = ordered;
        _refreshChipsVisualInEditor();
        renderInlineSlotsBuilder();
    }

    function _saveEditorRange() {
        const formModal = getEl('modal-jp-form');
        if (!formModal || formModal.style.display !== 'block') return;
        const editor = getEl('jp-content-editor');
        const sel = window.getSelection();
        if (!editor || !sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
            lastSavedRange = range.cloneRange();
        }
    }

    function setEditingKind(kind, { silent = false } = {}) {
        const targetKind = kind === 'bloco' ? 'bloco' : 'modelo';

        if (!silent && targetKind === 'bloco' && editingKind !== 'bloco') {
            const hasConfig =
                editingInlineSlots.length > 0 ||
                editingCustomFields.length > 0 ||
                editingSubPromptIds.length > 0;

            if (hasConfig) {
                const ok = confirm(
                    'Converter este modelo em "Bloco de Preenchimento" removerá todos os formulários no texto, campos extras e subprompts vinculados.\n\nDeseja realmente continuar?'
                );
                if (!ok) return;
            }
        }

        editingKind = targetKind;
        const isBloco = editingKind === 'bloco';

        document.querySelectorAll('#jp-kind-switcher .jp-mode-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.kindVal === editingKind);
        });

        const btnInsert = getEl('jp-btn-insert-slot');
        const hint = getEl('jp-editor-hint');
        const label = getEl('jp-editor-label');
        const buildersCol = getEl('jp-right-column-builders');
        const blocoInfo = getEl('jp-right-column-bloco-info');

        if (btnInsert) btnInsert.style.display = isBloco ? 'none' : 'inline-flex';
        if (hint) hint.style.display = isBloco ? 'none' : 'block';
        if (label) label.textContent = isBloco ? 'Teor do Bloco de Preenchimento (Obrigatório)' : 'Teor do Prompt Base (Obrigatório)';
        if (buildersCol) buildersCol.style.display = isBloco ? 'none' : 'flex';
        if (blocoInfo) blocoInfo.style.display = isBloco ? 'block' : 'none';

        if (isBloco && !silent) {
            const editor = getEl('jp-content-editor');
            editor?.querySelectorAll('.jp-slot-chip').forEach(c => c.remove());
            editingInlineSlots = [];
            editingCustomFields = [];
            editingSubPromptIds = [];
            slotGraveyard.clear();
            renderInlineSlotsBuilder();
            renderBuilder();
            renderSubPromptsBuilder();
        }
    }

    function insertInlineSlotAtCursor() {
        if (editingKind === 'bloco') return;
        const editor = getEl('jp-content-editor');
        if (!editor) return;

        const slotId = 'slot_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const newSlot = {
            id: slotId,
            label: `Formulário ${editingInlineSlots.length + 1}`,
            defaultMode: 'manual',
            candidateSubPromptIds: []
        };
        editingInlineSlots.push(newSlot);

        editor.focus();
        const sel = window.getSelection();
        let range;
        if (lastSavedRange && editor.contains(lastSavedRange.commonAncestorContainer)) {
            range = _normalizeRangeOutsideChips(lastSavedRange.cloneRange());
        } else {
            range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);

        const chipHtml = _buildSlotChipHtml(newSlot, editingInlineSlots.length - 1) + ' ';
        _insertHtmlWithUndo(chipHtml, slotId, () => {
            range.deleteContents();
            const chip = _createSlotChipElement(newSlot, editingInlineSlots.length - 1);
            const space = document.createTextNode(' ');
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        });

        _saveEditorRange();
        _reconcileSlotsWithEditor(true);

        const cardDetails = document.querySelector(`.jp-slot-accordion[data-slot-card="${CSS.escape(slotId)}"]`);
        if (cardDetails) {
            cardDetails.open = true;
            const input = cardDetails.querySelector(`[data-slot-label-input="${CSS.escape(slotId)}"]`);
            if (input) { input.focus(); input.select(); }
        }
    }

    function renderInlineSlotsBuilder() {
        const container = getEl('jp-inline-slots-container');
        const countBadge = getEl('jp-inline-slots-count');
        if (countBadge) countBadge.textContent = String(editingInlineSlots.length);
        if (!container) return;

        const openIds = new Set(
            Array.from(container.querySelectorAll('.jp-slot-accordion[open]')).map(el => el.dataset.slotCard)
        );

        if (editingInlineSlots.length === 0) {
            container.innerHTML = `<div style="font-size: 0.76rem; color: #94a3b8; text-align: center; padding: 0.65rem; border: 1px dashed #cbd5e0; border-radius: 6px;">Nenhum formulário inserido no texto.</div>`;
            return;
        }

        const currentEditingId = getEl('jp-id')?.value || '';
        const promptMap = new Map(prompts.map(p => [p.id, p]));
        const sortedAll = getDefaultSortedPrompts(prompts).filter(p => p.id !== currentEditingId);
        const blockCandidates = sortedAll.filter(p => getPromptKind(p) === 'bloco');
        const pureModelCandidates = sortedAll.filter(p => getPromptKind(p) !== 'bloco' && !hasInteractiveFields(p));

        container.innerHTML = editingInlineSlots.map((slot, idx) => {
            const isOpen = openIds.has(slot.id);
            const linkedIds = (slot.candidateSubPromptIds || []).filter(id => {
                const obj = promptMap.get(id);
                return obj && obj.id !== currentEditingId && !hasInteractiveFields(obj);
            });
            const availBlocks = blockCandidates.filter(p => !linkedIds.includes(p.id));
            const availPureModels = pureModelCandidates.filter(p => !linkedIds.includes(p.id));
            const modeIcon = slot.defaultMode === 'subprompt' ? '🧩' : '✍️';

            let selectOpts = `<option value="">+ Sugerir bloco de preenchimento...</option>`;
            if (availBlocks.length > 0) {
                selectOpts += `<optgroup label="🧩 Blocos de Preenchimento">` +
                    availBlocks.map(b => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('') +
                    `</optgroup>`;
            }
            if (availPureModels.length > 0) {
                selectOpts += `<optgroup label="📄 Modelos simples (sem subcampos)">` +
                    availPureModels.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('') +
                    `</optgroup>`;
            }

            const tagsHtml = linkedIds.length > 0
                ? linkedIds.map(cid => `
                    <span class="jp-slot-candidate-tag">
                        <span>${escapeHtml(promptMap.get(cid).title)}</span>
                        <button type="button" onclick="PromptUIController.removeSlotCandidate('${slot.id}', '${cid}')" title="Remover sugestão">×</button>
                    </span>
                `).join('')
                : `<span style="font-size: 0.72rem; color: #94a3b8;">Sem sugestões fixas: todos os blocos ficarão disponíveis na execução.</span>`;

            return `
                <details class="jp-slot-accordion" data-slot-card="${slot.id}" ${isOpen ? 'open' : ''}>
                    <summary class="jp-slot-accordion__summary">
                        <div style="display:flex; align-items:center; gap:7px; min-width:0;">
                            <span class="jp-slot-chip__badge">${idx + 1}</span>
                            <span class="jp-slot-accordion__title" data-slot-summary-title="${slot.id}">${escapeHtml(slot.label || `Formulário ${idx + 1}`)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <span data-slot-summary-mode="${slot.id}" title="Modo padrão na execução">${modeIcon}</span>
                            <span style="font-size:0.7rem; color:#64748b;">${linkedIds.length > 0 ? `${linkedIds.length} sug.` : ''}</span>
                            <span class="jp-accordion-chevron">▾</span>
                        </div>
                    </summary>
                    <div class="jp-slot-accordion__body">
                        <div style="display:flex; gap:6px; align-items:center;">
                            <input type="text"
                                   class="jp-input"
                                   style="padding: 0.4rem 0.6rem; font-size: 0.84rem; flex: 1;"
                                   data-slot-label-input="${slot.id}"
                                   value="${escapeHtml(slot.label)}"
                                   placeholder="Nome do formulário"
                                   oninput="PromptUIController.updInlineSlotLabel('${slot.id}', this.value)">
                            <button type="button" class="jp-mini-btn danger" onclick="PromptUIController.removeInlineSlot('${slot.id}')" title="Remover formulário e marcador do texto">✕</button>
                        </div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <label style="font-size:0.72rem; color:#475569; margin:0; text-transform:none;">Modo padrão:</label>
                            <select class="jp-input" style="padding:0.25rem 0.5rem; font-size:0.76rem; width:auto;" onchange="PromptUIController.updInlineSlotDefaultMode('${slot.id}', this.value)">
                                <option value="manual" ${slot.defaultMode !== 'subprompt' ? 'selected' : ''}>✍️ Preenchimento Manual</option>
                                <option value="subprompt" ${slot.defaultMode === 'subprompt' ? 'selected' : ''}>🧩 Bloco / Subprompt</option>
                            </select>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <select id="jp-slot-cand-sel-${slot.id}" class="jp-input" style="padding: 0.35rem 0.5rem; font-size: 0.78rem; flex:1;">
                                ${selectOpts}
                            </select>
                            <button type="button" class="jp-mini-btn" style="width:auto; padding:0 8px;" onclick="PromptUIController.addSlotCandidate('${slot.id}')">+</button>
                        </div>
                        <div class="jp-slot-candidate-tags">${tagsHtml}</div>
                    </div>
                </details>
            `;
        }).join('');
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
            const badgeExtras = _buildInteractiveBadgesHtml(p);
            
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
                const subBadgeExtras = _buildInteractiveBadgesHtml(sub);
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
        const countEl = getEl('jp-custom-fields-count');
        if (countEl) countEl.textContent = String(editingCustomFields.length);
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
            return normalizeText(p.title).includes(filterTerm) || normalizeText(stripSlotTokens(p.content)).includes(filterTerm);
        });

        selectEl.innerHTML = `<option value="">${candidates.length === 0 ? 'Nenhum modelo disponível para o filtro...' : 'Selecione um prompt salvo para vincular...'}</option>` +
            candidates.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('');

        const validLinkedIds = editingSubPromptIds.filter(id => promptMap.has(id));
        const subCountEl = getEl('jp-subprompts-count');
        if (subCountEl) subCountEl.textContent = String(validLinkedIds.length);

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
        _syncHideBlocksToggle();

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
        const content = serializePromptEditor().trim();
        const fields = editingCustomFields
            .filter(f => (f.label || '').trim() !== '' || (f.options || '').trim() !== '' || (f.guidelines || '').trim() !== '')
            .map(f => ({
                type: f.type,
                label: (f.label || '').trim(),
                options: (f.options || '').trim(),
                guidelines: (f.guidelines || '').trim()
            }));
        const slots = editingInlineSlots.map(s => ({
            id: s.id,
            label: (s.label || '').trim(),
            defaultMode: s.defaultMode === 'subprompt' ? 'subprompt' : 'manual',
            candidateSubPromptIds: [...(s.candidateSubPromptIds || [])]
        }));
        return JSON.stringify({
            title,
            kind: editingKind,
            content,
            inlineSlots: slots,
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
        slotGraveyard.clear();
        lastSavedRange = null;

        getEl('jp-id').value = '';
        getEl('jp-title-input').value = '';
        if (getEl('jp-subprompt-filter')) getEl('jp-subprompt-filter').value = '';
        getEl('jp-form-title').innerText = 'Novo Modelo';

        editingCustomFields = [];
        editingSubPromptIds = [];
        editingInlineSlots = [];

        setEditingKind('modelo', { silent: true });
        hydratePromptEditor('', []);
        renderInlineSlotsBuilder();
        renderBuilder();
        renderSubPromptsBuilder();

        if (getEl('jp-acc-custom-fields')) getEl('jp-acc-custom-fields').open = false;
        if (getEl('jp-acc-subprompts')) getEl('jp-acc-subprompts').open = false;

        initialFormSnapshot = _getFormStateSerialized();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
        requestAnimationFrame(() => getEl('jp-title-input')?.focus());
    }

    function openEditModal(id) {
        fecharModalPrincipal();
        const p = prompts.find(x => x.id === id);
        if (!p) return;

        slotGraveyard.clear();
        lastSavedRange = null;

        getEl('jp-id').value = p.id;
        getEl('jp-title-input').value = p.title;
        if (getEl('jp-subprompt-filter')) getEl('jp-subprompt-filter').value = '';
        getEl('jp-form-title').innerText = getPromptKind(p) === 'bloco' ? 'Editar Bloco' : 'Editar Modelo';

        editingCustomFields = Array.isArray(p.customFields) ? JSON.parse(JSON.stringify(p.customFields)) : [];
        const promptIdsSet = new Set(prompts.map(item => item.id));
        editingSubPromptIds = Array.isArray(p.subPromptIds)
            ? p.subPromptIds.filter(subId => subId !== p.id && promptIdsSet.has(subId))
            : [];
        editingInlineSlots = Array.isArray(p.inlineSlots)
            ? JSON.parse(JSON.stringify(p.inlineSlots))
            : [];

        setEditingKind(getPromptKind(p), { silent: true });
        hydratePromptEditor(p.content || '', editingInlineSlots);
        renderInlineSlotsBuilder();
        renderBuilder();
        renderSubPromptsBuilder();

        if (getEl('jp-acc-custom-fields')) getEl('jp-acc-custom-fields').open = editingCustomFields.length > 0;
        if (getEl('jp-acc-subprompts')) getEl('jp-acc-subprompts').open = false;

        initialFormSnapshot = _getFormStateSerialized();
        getEl('backdrop-jp-form').classList.add('active');
        getEl('modal-jp-form').style.display = 'block';
        requestAnimationFrame(() => getEl('jp-title-input')?.focus());
    }

    function closeAddModal(force = false) {
        if (!force && _isFormDirty()) {
            const confirmarDescarte = confirm('Existem alterações não salvas neste item. Deseja realmente descartá-las e voltar?');
            if (!confirmarDescarte) return;
        }
        initialFormSnapshot = null;
        slotGraveyard.clear();
        lastSavedRange = null;
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
                await navigator.clipboard.writeText(stripSlotTokens(targetPrompt.content).trim());
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

    function assemblePromptWithSlots(rawTemplate, slotValues) {
        const parts = tokenizeTemplate(rawTemplate || '');
        let acc = '';
        let lastWasOmittedSlot = false;

        for (const part of parts) {
            if (part.type === 'slot') {
                const val = slotValues.get(part.id) || '';
                if (val) {
                    acc += val;
                    lastWasOmittedSlot = false;
                } else {
                    lastWasOmittedSlot = true;
                }
                continue;
            }

            let chunk = part.value;
            if (lastWasOmittedSlot) {
                // 1. Limpa recuo órfão se o slot omitido era o único conteúdo de uma linha indentada
                if (/^\n/.test(chunk) && /(?:^|\n)[ \t]+$/.test(acc)) {
                    acc = acc.replace(/(^|\n)[ \t]+$/, '$1');
                }

                // 2. Sobreposição de quebras de linha apenas na emenda (ex: "p1\n{{S}}\np2" -> "p1\np2")
                const tailNl = (acc.match(/\n*$/) || [''])[0].length;
                const headNl = (chunk.match(/^\n*/) || [''])[0].length;
                if (tailNl > 0 && headNl > 0) {
                    chunk = chunk.slice(Math.min(tailNl, headNl));
                } else if (/[ \t]$/.test(acc) && /^[ \t]/.test(chunk)) {
                    // 3. Espaço duplicado entre palavras vizinhas
                    chunk = chunk.replace(/^[ \t]+/, '');
                } else if (/[ \t]$/.test(acc) && /^[.,;:!?)\]]/.test(chunk)) {
                    // 4. Espaço antes de pontuação/fechamento (ex: "considerando {{S}}." -> "considerando.")
                    acc = acc.replace(/[ \t]+$/, '');
                }
                lastWasOmittedSlot = false;
            }
            acc += chunk;
        }

        return stripSlotTokens(acc).trim();
    }

    function _resetCopyConfirmState() {
        const btn = getEl('jp-btn-copy-final');
        if (!btn) return;
        btn.dataset.confirmEmpty = 'false';
        btn.classList.remove('is-confirming-empty');
        const span = btn.querySelector('span');
        if (span) span.textContent = 'Copiar Definitivo';
    }

    // Abertura Gerador
    function openGenModal(id) {
        fecharModalPrincipal();
        currentActivePrompt = prompts.find(x => x.id === id);
        if (!currentActivePrompt) return;

        _resetCopyConfirmState();
        const previewEl = getEl('jp-gen-base-preview');
        const inlineContainer = getEl('jp-gen-inline-slots');
        const genDiv = getEl('jp-gen-dynamic');
        const slots = Array.isArray(currentActivePrompt.inlineSlots) ? currentActivePrompt.inlineSlots : [];

        if (previewEl) {
            previewEl.innerHTML = '';
            const slotMap = new Map(slots.map((s, idx) => [s.id, { slot: s, idx }]));
            const frag = document.createDocumentFragment();
            tokenizeTemplate(currentActivePrompt.content || '').forEach(part => {
                if (part.type === 'text') {
                    _appendTextWithBr(frag, part.value);
                } else {
                    const found = slotMap.get(part.id);
                    if (found) {
                        const chip = document.createElement('span');
                        chip.className = 'jp-slot-chip';
                        chip.dataset.jumpSlot = found.slot.id;
                        chip.title = `Ir para: ${found.slot.label}`;
                        chip.innerHTML = `<span class="jp-slot-chip__badge">${found.idx + 1}</span><span>${escapeHtml(found.slot.label)}</span>`;
                        frag.appendChild(chip);
                    }
                }
            });
            previewEl.appendChild(frag);
        }

        if (inlineContainer) {
            inlineContainer.innerHTML = '';
            if (slots.length > 0) {
                inlineContainer.style.display = 'block';
                const promptMap = new Map(prompts.map(p => [p.id, p]));
                const sortedOthers = getDefaultSortedPrompts(prompts).filter(p => p.id !== currentActivePrompt.id);
                const eligibleBlocks = sortedOthers.filter(p => getPromptKind(p) === 'bloco');
                const eligibleModels = sortedOthers.filter(p => getPromptKind(p) !== 'bloco' && !hasInteractiveFields(p));

                inlineContainer.innerHTML = slots.map((slot, idx) => {
                    const startSub = slot.defaultMode === 'subprompt';
                    const suggestedIds = (slot.candidateSubPromptIds || []).filter(cid => {
                        const obj = promptMap.get(cid);
                        return obj && obj.id !== currentActivePrompt.id && !hasInteractiveFields(obj);
                    });
                    const otherBlocks = eligibleBlocks.filter(p => !suggestedIds.includes(p.id));
                    const otherModels = eligibleModels.filter(p => !suggestedIds.includes(p.id));

                    let optionsHtml = `<option value="">Selecione o bloco para este espaço...</option>`;
                    if (suggestedIds.length > 0) {
                        optionsHtml += `<optgroup label="⭐ Sugeridos para este espaço">` +
                            suggestedIds.map(cid => `<option value="${cid}">${escapeHtml(promptMap.get(cid).title)}</option>`).join('') +
                            `</optgroup>`;
                    }
                    if (otherBlocks.length > 0) {
                        optionsHtml += `<optgroup label="🧩 Blocos de Preenchimento">` +
                            otherBlocks.map(b => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('') +
                            `</optgroup>`;
                    }
                    if (otherModels.length > 0) {
                        optionsHtml += `<optgroup label="📚 Outros modelos (texto puro)">` +
                            otherModels.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('') +
                            `</optgroup>`;
                    }

                    return `
                        <div class="jp-gen-slot-card" data-gen-slot-id="${slot.id}" data-active-mode="${startSub ? 'subprompt' : 'manual'}">
                            <div class="jp-gen-slot-header">
                                <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:#1e293b;">
                                    <span class="jp-slot-chip__badge">${idx + 1}</span>
                                    <span>${escapeHtml(slot.label)}</span>
                                </div>
                                <div class="jp-mode-switcher">
                                    <button type="button" class="jp-mode-btn ${!startSub ? 'is-active' : ''}" onclick="PromptUIController.switchGenSlotMode('${slot.id}', 'manual')">✍️ Manual</button>
                                    <button type="button" class="jp-mode-btn ${startSub ? 'is-active' : ''}" onclick="PromptUIController.switchGenSlotMode('${slot.id}', 'subprompt')">🧩 Bloco</button>
                                </div>
                            </div>
                            <div class="jp-gen-slot-manual" style="display: ${!startSub ? 'block' : 'none'};">
                                <textarea class="jp-input jp-gen-slot-textarea" data-slot-id="${slot.id}" style="min-height: 72px;" placeholder="Digite o texto para '${escapeHtml(slot.label)}'..."></textarea>
                            </div>
                            <div class="jp-gen-slot-subprompt" style="display: ${startSub ? 'block' : 'none'};">
                                <select class="jp-input jp-gen-slot-select" data-slot-id="${slot.id}" onchange="PromptUIController.previewGenSlotSubprompt('${slot.id}', this.value)">
                                    ${optionsHtml}
                                </select>
                                <div class="jp-subprompt-live-preview" id="jp-slot-preview-${slot.id}" style="display:none;"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                inlineContainer.style.display = 'none';
            }
        }

        genDiv.innerHTML = '';
        genDiv.style.display = 'none';
        if (Array.isArray(currentActivePrompt.customFields) && currentActivePrompt.customFields.length > 0) {
            genDiv.style.display = 'block';
            let html = `<div style="font-size:0.85rem; font-weight:bold; color: var(--theme-primary, #b48500); margin-bottom:10px;">Campos Adicionais (Final do Prompt):</div>`;
            currentActivePrompt.customFields.forEach(f => {
                html += `<div class="jp-form-group"><label>${escapeHtml(f.label)}</label>`;
                if (f.type === 'text') {
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
        _resetCopyConfirmState();
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

        if (editingKind !== 'bloco') {
            _reconcileSlotsWithEditor(true);
        }
        const rawContent = serializePromptEditor().trim();
        if (!title || !rawContent) { alert('Preencha nome e teor.'); return; }

        const isBloco = editingKind === 'bloco';
        const existingPrompt = id ? prompts.find(p => p.id === id) : null;
        const validFields = isBloco ? [] : editingCustomFields.filter(f => f.label.trim() !== '');
        const validSubIds = isBloco ? [] : editingSubPromptIds.filter(subId => subId !== id && prompts.some(p => p.id === subId));
        const validInlineSlots = isBloco ? [] : editingInlineSlots.map((s, i) => ({
            id: s.id,
            label: (s.label || '').trim() || `Formulário ${i + 1}`,
            defaultMode: s.defaultMode === 'subprompt' ? 'subprompt' : 'manual',
            candidateSubPromptIds: (s.candidateSubPromptIds || []).filter(cid => {
                const candidate = prompts.find(p => p.id === cid);
                return candidate && cid !== id && !hasInteractiveFields(candidate);
            })
        }));

        const promptObj = {
            title,
            kind: editingKind,
            content: isBloco ? stripSlotTokens(rawContent) : rawContent,
            inlineSlots: validInlineSlots,
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

            if (validSubIds.length > 0) expandedBranchIds.add(finalId);

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
        const inlineParents = getPromptsUsingInInlineSlots(id);
        let msgConfirm = `Excluir "${targetPrompt.title}" da nuvem definitivamente?`;

        if (parentRoutines.length > 0 || inlineParents.length > 0) {
            const blocosAviso = [];
            if (parentRoutines.length > 0) {
                blocosAviso.push(`• Ramificação de ${parentRoutines.length} rotina(s):\n${parentRoutines.map(r => `  - ${r.title}`).join('\n')}`);
            }
            if (inlineParents.length > 0) {
                blocosAviso.push(`• Sugestão de preenchimento em ${inlineParents.length} modelo(s):\n${inlineParents.map(r => `  - ${r.title}`).join('\n')}`);
            }
            msgConfirm = `⚠️ ATENÇÃO — ITEM VINCULADO\n\n` +
                         `"${targetPrompt.title}" está referenciado em:\n${blocosAviso.join('\n\n')}\n\n` +
                         `Se você excluí-lo, ele será removido permanentemente da nuvem e desses vínculos.\n\n` +
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
                        parentUpdates.push(window.FirebasePrompts.atualizarCampos(parent.id, { subPromptIds: parent.subPromptIds }));
                    }
                });

                inlineParents.forEach(parent => {
                    parent.inlineSlots = parent.inlineSlots.map(slot => ({
                        ...slot,
                        candidateSubPromptIds: (slot.candidateSubPromptIds || []).filter(cid => cid !== id)
                    }));
                    if (typeof window.FirebasePrompts.atualizarCampos === 'function') {
                        parentUpdates.push(window.FirebasePrompts.atualizarCampos(parent.id, { inlineSlots: parent.inlineSlots }));
                    }
                });

                if (parentUpdates.length > 0) await Promise.allSettled(parentUpdates);

                PromptUIController.filter();
                if (window.exibirToast) window.exibirToast('Item excluído!', 'sucesso');
            } catch (error) {
                console.error("Juris Prompts [Erro ao excluir modelo]:", error);
                if (window.exibirToast) window.exibirToast('Falha ao excluir.', 'erro');
            } finally {
                isSyncing = false;
            }
        }
    }

    async function copyToClipboard() {
        const btnCopy = getEl('jp-btn-copy-final');
        const inlineSlots = Array.isArray(currentActivePrompt.inlineSlots) ? currentActivePrompt.inlineSlots : [];
        const promptMap = new Map(prompts.map(p => [p.id, p]));
        const slotValues = new Map();
        let emptyCount = 0;

        inlineSlots.forEach(slot => {
            const card = document.querySelector(`.jp-gen-slot-card[data-gen-slot-id="${CSS.escape(slot.id)}"]`);
            card?.classList.remove('is-empty-warning');
            const activeMode = card?.dataset.activeMode || 'manual';
            let val = '';

            if (activeMode === 'subprompt') {
                const sel = card?.querySelector('.jp-gen-slot-select');
                const chosen = sel?.value ? promptMap.get(sel.value) : null;
                val = chosen ? stripSlotTokens(chosen.content).trim() : '';
            } else {
                const ta = card?.querySelector('.jp-gen-slot-textarea');
                val = ta ? ta.value.trim() : '';
            }

            if (!val) {
                emptyCount++;
                card?.classList.add('is-empty-warning');
            }
            slotValues.set(slot.id, val);
        });

        // Confirmação em 2 cliques sem confirm() bloqueante (100% compatível com User Activation no Firefox)
        if (emptyCount > 0 && btnCopy?.dataset.confirmEmpty !== 'true') {
            if (btnCopy) {
                btnCopy.dataset.confirmEmpty = 'true';
                btnCopy.classList.add('is-confirming-empty');
                const span = btnCopy.querySelector('span');
                if (span) {
                    span.textContent = `⚠️ ${emptyCount} espaço${emptyCount > 1 ? 's' : ''} vazio${emptyCount > 1 ? 's' : ''} — Clique novamente para copiar omitindo`;
                }
            }
            document.querySelector('.jp-gen-slot-card.is-empty-warning')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        let final = assemblePromptWithSlots(currentActivePrompt.content, slotValues) + "\n\n";

        if (Array.isArray(currentActivePrompt.customFields) && currentActivePrompt.customFields.length > 0) {
            let extrasText = "--- INSTRUÇÕES ADICIONAIS / CONTEXTO DA PEÇA ---\n\n";
            currentActivePrompt.customFields.forEach(f => {
                extrasText += `### ${f.label} ###\n`;
                if (f.type === 'text') {
                    const inp = document.querySelector(`.jp-dyn-txt[data-label="${CSS.escape(f.label)}"]`);
                    const valor = inp ? inp.value.trim() : '';
                    extrasText += valor !== ''
                        ? `${valor}\n\n`
                        : `[Atenção IA: Nenhuma informação foi fornecida pelo usuário para este tópico. Não presuma dados.]\n\n`;
                } else if (f.type === 'checkbox') {
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
            await navigator.clipboard.writeText(stripSlotTokens(final).trim());
            _resetCopyConfirmState();
            const copiedId = currentActivePrompt.id;
            const ctxParentId = currentExecutionContext.parentId || copiedId;
            const ctxStepIdx = currentExecutionContext.stepIdx;

            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Prompt estruturado e copiado com sucesso!', 'sucesso');
            }
            closeGenModal();
            _markStepExecuted(copiedId, ctxParentId, ctxStepIdx);
        } catch (e) {
            console.error("Juris Prompts [Clipboard Error]:", e);
            alert('Falha ao acessar a área de transferência. Verifique as permissões do navegador.');
        }
    }

    // Delegação de Eventos Global Unificada (Busca, Filtro de Subprompts, Editor Rico e Modal Gerador)
    document.addEventListener('input', (e) => {
        if (!e.target) return;
        if (e.target.id === 'jp-search') {
            const btnClear = document.getElementById('jp-btn-clear-search');
            if (btnClear) btnClear.style.display = e.target.value.length > 0 ? 'flex' : 'none';
            PromptUIController.filter();
        } else if (e.target.id === 'jp-subprompt-filter') {
            renderSubPromptsBuilder();
        } else if (e.target.id === 'jp-content-editor') {
            _reconcileSlotsWithEditor(false);
        } else if (e.target.closest('#jp-gen-inline-slots')) {
            e.target.closest('.jp-gen-slot-card')?.classList.remove('is-empty-warning');
            _resetCopyConfirmState();
        }
    });

    document.addEventListener('change', (e) => {
        if (!e.target) return;
        if (e.target.matches('[data-jp-direct-toggle="true"]')) {
            toggleDirectCopyMode(e.target.checked);
        } else if (e.target.id === 'jp-hide-blocks-toggle') {
            hideBlocksInList = Boolean(e.target.checked);
            localStorage.setItem(STORAGE_HIDE_BLOCKS_KEY, String(hideBlocksInList));
            PromptUIController.filter();
        } else if (e.target.closest('#jp-gen-inline-slots')) {
            e.target.closest('.jp-gen-slot-card')?.classList.remove('is-empty-warning');
            _resetCopyConfirmState();
        }
    });

    document.addEventListener('selectionchange', _saveEditorRange);

    // Bloqueia drag interno no editor (evita duplicação de texto e corrupção de chips)
    document.addEventListener('dragstart', (e) => {
        if (e.target?.closest?.('#jp-content-editor')) {
            e.preventDefault();
        }
    });

    // Copy & Cut com Dual-MIME e Undo nativo preservado
    function _handleEditorCopyOrCut(e, isCut) {
        const editor = getEl('jp-content-editor');
        if (!editor || !e.target?.closest('#jp-content-editor')) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

        const range = sel.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) return;

        const fragment = range.cloneContents();
        e.preventDefault();
        e.clipboardData.setData(CLIPBOARD_MIME_JURIS, _serializeNodes(fragment, false));
        e.clipboardData.setData('text/plain', _serializeNodes(fragment, true));

        if (isCut) {
            document.execCommand('delete');
            _reconcileSlotsWithEditor(false);
        }
    }
    document.addEventListener('copy', (e) => _handleEditorCopyOrCut(e, false));
    document.addEventListener('cut', (e) => _handleEditorCopyOrCut(e, true));

    // Paste com reconstrução segura via insertHTML (escapeHtml preserva tags XML de prompts + Undo unificado)
    document.addEventListener('paste', (e) => {
        const editor = getEl('jp-content-editor');
        if (!editor || !e.target?.closest('#jp-content-editor')) return;
        e.preventDefault();

        const internalRaw = e.clipboardData?.getData(CLIPBOARD_MIME_JURIS) || '';
        const plainRaw = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');

        if (internalRaw && editingKind !== 'bloco') {
            const parts = tokenizeTemplate(internalRaw.replace(/\r\n?/g, '\n'));
            const restorableIds = [];
            parts.forEach(p => {
                if (p.type === 'slot' &&
                    slotGraveyard.has(p.id) &&
                    !editor.querySelector(`.jp-slot-chip[data-slot-id="${CSS.escape(p.id)}"]`)) {
                    restorableIds.push(p.id);
                }
            });

            if (restorableIds.length > 0) {
                const seenInPaste = new Set();
                const safeHtml = parts.map(part => {
                    if (part.type === 'text') {
                        return escapeHtml(part.value).replace(/\n/g, '<br>');
                    }
                    if (!seenInPaste.has(part.id) && restorableIds.includes(part.id)) {
                        seenInPaste.add(part.id);
                        return _buildSlotChipHtml(slotGraveyard.get(part.id), editingInlineSlots.length);
                    }
                    return '';
                }).join('');

                _insertHtmlWithUndo(safeHtml, restorableIds[0], () => {
                    const sel = window.getSelection();
                    if (!sel || sel.rangeCount === 0) return;
                    const range = _normalizeRangeOutsideChips(sel.getRangeAt(0));
                    range.deleteContents();
                    const frag = document.createDocumentFragment();
                    const seenFallback = new Set();
                    parts.forEach(part => {
                        if (part.type === 'text') {
                            _appendTextWithBr(frag, part.value);
                        } else if (!seenFallback.has(part.id) && restorableIds.includes(part.id)) {
                            seenFallback.add(part.id);
                            frag.appendChild(_createSlotChipElement(slotGraveyard.get(part.id), editingInlineSlots.length));
                        }
                    });
                    range.insertNode(frag);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                });

                _reconcileSlotsWithEditor(true);
                return;
            }
        }

        document.execCommand('insertText', false, stripSlotTokens(plainRaw));
    });

    // Drop externo na coordenada exata (evita cair dentro de .jp-slot-chip não editável)
    function _setCaretFromPoint(x, y) {
        let range = null;
        if (typeof document.caretPositionFromPoint === 'function') {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            }
        } else if (typeof document.caretRangeFromPoint === 'function') {
            range = document.caretRangeFromPoint(x, y);
        }
        if (range) {
            _normalizeRangeOutsideChips(range);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    document.addEventListener('drop', (e) => {
        const editor = getEl('jp-content-editor');
        if (!editor || !e.target?.closest('#jp-content-editor')) return;
        e.preventDefault();
        const plain = stripSlotTokens((e.dataTransfer?.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
        if (!plain) return;
        editor.focus();
        _setCaretFromPoint(e.clientX, e.clientY);
        document.execCommand('insertText', false, plain);
    });

    document.addEventListener('click', (e) => {
        const removeId = e.target?.dataset?.removeSlot;
        if (removeId) {
            PromptUIController.removeInlineSlot(removeId);
            return;
        }
        const editChip = e.target?.closest('#jp-content-editor .jp-slot-chip');
        if (editChip) {
            const card = document.querySelector(`.jp-slot-accordion[data-slot-card="${CSS.escape(editChip.dataset.slotId)}"]`);
            if (card) {
                card.open = true;
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                card.querySelector('input')?.focus();
            }
            return;
        }
        const jumpChip = e.target?.closest('#jp-gen-base-preview [data-jump-slot]');
        if (jumpChip) {
            const card = document.querySelector(`.jp-gen-slot-card[data-gen-slot-id="${CSS.escape(jumpChip.dataset.jumpSlot)}"]`);
            card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    _syncHideBlocksToggle();
    document.addEventListener('DOMContentLoaded', () => {
        _syncAllDirectCopyToggles();
        _syncHideBlocksToggle();
    });

    return {
        abrirModal,
        fecharModalPrincipal,
        filter: () => {
            const searchEl = getEl('jp-search');
            const rawTerm = searchEl ? searchEl.value : '';
            const normTerm = normalizeText(rawTerm);
            const visiblePool = hideBlocksInList
                ? prompts.filter(p => getPromptKind(p) !== 'bloco')
                : prompts;

            if (!normTerm) {
                renderList(getDefaultSortedPrompts(visiblePool));
                return;
            }

            const titleMatches = [];
            const contentMatches = [];
            const contentMatchIds = new Set();

            visiblePool.forEach(p => {
                const inTitle = normalizeText(p.title).includes(normTerm);
                if (inTitle) {
                    titleMatches.push(p);
                } else if (normalizeText(stripSlotTokens(p.content)).includes(normTerm)) {
                    contentMatches.push(p);
                    contentMatchIds.add(p.id);
                }
            });

            renderList(
                [...getDefaultSortedPrompts(titleMatches), ...getDefaultSortedPrompts(contentMatches)],
                contentMatchIds
            );
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
        setEditingKind,
        insertInlineSlotAtCursor,
        updInlineSlotLabel: (slotId, val) => {
            const s = editingInlineSlots.find(x => x.id === slotId);
            if (!s) return;
            s.label = val;
            _refreshChipsVisualInEditor();
            const summaryTitle = document.querySelector(`[data-slot-summary-title="${CSS.escape(slotId)}"]`);
            if (summaryTitle) summaryTitle.textContent = val || 'Formulário';
        },
        updInlineSlotDefaultMode: (slotId, mode) => {
            const s = editingInlineSlots.find(x => x.id === slotId);
            if (!s) return;
            s.defaultMode = mode === 'subprompt' ? 'subprompt' : 'manual';
            const summaryMode = document.querySelector(`[data-slot-summary-mode="${CSS.escape(slotId)}"]`);
            if (summaryMode) summaryMode.textContent = s.defaultMode === 'subprompt' ? '🧩' : '✍️';
        },
        addSlotCandidate: (slotId) => {
            const s = editingInlineSlots.find(x => x.id === slotId);
            const sel = getEl(`jp-slot-cand-sel-${slotId}`);
            if (s && sel?.value && !s.candidateSubPromptIds.includes(sel.value)) {
                s.candidateSubPromptIds.push(sel.value);
                renderInlineSlotsBuilder();
            }
        },
        removeSlotCandidate: (slotId, cid) => {
            const s = editingInlineSlots.find(x => x.id === slotId);
            if (s) {
                s.candidateSubPromptIds = s.candidateSubPromptIds.filter(id => id !== cid);
                renderInlineSlotsBuilder();
            }
        },
        removeInlineSlot: (slotId) => {
            const removed = editingInlineSlots.find(s => s.id === slotId);
            if (removed) slotGraveyard.set(slotId, removed);
            editingInlineSlots = editingInlineSlots.filter(s => s.id !== slotId);
            document.querySelector(`#jp-content-editor .jp-slot-chip[data-slot-id="${CSS.escape(slotId)}"]`)?.remove();
            _refreshChipsVisualInEditor();
            renderInlineSlotsBuilder();
        },
        switchGenSlotMode: (slotId, mode) => {
            const card = document.querySelector(`.jp-gen-slot-card[data-gen-slot-id="${CSS.escape(slotId)}"]`);
            if (!card) return;
            card.dataset.activeMode = mode;
            card.classList.remove('is-empty-warning');
            _resetCopyConfirmState();
            card.querySelectorAll('.jp-mode-btn').forEach((b, i) =>
                b.classList.toggle('is-active', (i === 0 && mode === 'manual') || (i === 1 && mode === 'subprompt'))
            );
            card.querySelector('.jp-gen-slot-manual').style.display = mode === 'manual' ? 'block' : 'none';
            card.querySelector('.jp-gen-slot-subprompt').style.display = mode === 'subprompt' ? 'block' : 'none';
        },
        previewGenSlotSubprompt: (slotId, subId) => {
            const box = getEl(`jp-slot-preview-${slotId}`);
            const found = prompts.find(p => p.id === subId);
            if (!box) return;
            if (found) {
                box.textContent = stripSlotTokens(found.content);
                box.style.display = 'block';
            } else {
                box.style.display = 'none';
            }
        },
        savePrompt,
        toggleFavorite,
        deletePrompt,
        copyToClipboard
    };
})();