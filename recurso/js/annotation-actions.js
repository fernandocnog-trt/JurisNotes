/* ================================================
   annotation-actions.js
   Gerenciamento de Menus, Formatação Segura (Markdown) e Ações
   Versão: 2.1 (Refatoração: Single Source of Truth para Teses)
   ================================================ */

let _menuAnotacaoCtx = null;
let _menuSubAnotacaoCtx = null;
let _editContext = null;

function gerarUUIDSeguro() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36);
}

/* --- MENUS CONTEXTUAIS --- */
function abrirMenuAnotacao(topicoId, index, event) {
    event.stopPropagation();
    _menuAnotacaoCtx = { topicoId, index };
    _posicionarMenu('annotation-context-menu', event);
}

// HELPER PRIVADO (Resolução de Referência Universal)
function _resolverSubAlvo(topico, parentIndex, viewSource) {
    // 1. NÍVEL GLOBAL
    if (viewSource === 'global') {
        return { subAnotacoes: topico.diretrizesGlobais };
    }
    
    // 2. NÍVEL DE TESE
    if (typeof viewSource === 'string' && viewSource.startsWith('tese:')) {
        const nomeTese = viewSource.replace('tese:', '');
        return { subAnotacoes: topico.diretrizesPorTese[nomeTese] };
    }
    
    // 3. NÍVEL PROVA (Comportamento original preservado)
    const cardMestre = topico.anotacoes[parentIndex];
    if (viewSource === 'main') {
        return cardMestre;
    }
    const cIdx = parseInt(viewSource, 10);
    return cardMestre.itensCorrelacionados[cIdx];
}

window.toggleRevisaoNotaOculta = function(topicoId, parentIndex, viewSource, localIndex, event) {
    event.stopPropagation();
    
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico) return;

    const alvo = _resolverSubAlvo(topico, parentIndex, viewSource);
    const sub = alvo.subAnotacoes[localIndex];

    sub.revisada = !sub.revisada;

    renderizarTopicos(); 
    salvarBackupAutomatico();
};

function adicionarDiretrizEstrutural(tipo, topicoId, teseNome, event) {
    event.stopPropagation();
    _editContext = { 
        acao: 'adicionar', 
        tipoAdicao: 'diretriz', 
        escopo: tipo, 
        topicoId: topicoId, 
        teseNome: teseNome 
    };
    abrirModalEdicao(_editContext, '', '', '✨ Nova Diretriz Estrutural', 'Digite a instrução para a IA...');
}

function abrirMenuSubAnotacao(topicoId, parentIndex, viewSource, localIndex, event) {
    event.stopPropagation();
    
    const topico = topicos.find(t => t.id === topicoId);
    const alvo = _resolverSubAlvo(topico, parentIndex, viewSource);
    const sub = alvo.subAnotacoes[localIndex];

    // --- NOVA LÓGICA: SHIFT + CLICK ---
    if (event.shiftKey) {
        const naoClassificado = (sub.intencao === null || sub.intencao === undefined);
        if (naoClassificado) {
            exibirToast('Ação não classificada. Clique normalmente para definir a intenção para a IA.', 'aviso');
        } else {
            exibirTooltipRapido(sub.intencao, event);
        }
        return; // Impede a abertura do menu completo
    }

    const currentIntent = sub.intencao || 'premissa';
    
    document.querySelectorAll('#sub-annotation-context-menu .btn-intent').forEach(btn => {
        btn.classList.toggle('active-intent', btn.dataset.intent === currentIntent);
    });
    
    // NOVO CONTRATO: ctx exige viewSource e localIndex
    _menuSubAnotacaoCtx = { topicoId, parentIndex, viewSource, localIndex };
    _posicionarMenu('sub-annotation-context-menu', event);
}

function definirIntencaoSubAnotacao(intencaoStr) {
    if (!_menuSubAnotacaoCtx) return;
    
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    if (!topico) return;
    
    const alvo = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
    const sub = alvo.subAnotacoes[_menuSubAnotacaoCtx.localIndex];
    
    // Atualiza o estado
    sub.intencao = intencaoStr;
    
    renderizarTopicos(); 
    salvarBackupAutomatico();
    
    requestAnimationFrame(() => {
        // Busca o card baseando-se no viewSource e no localIndex recém-renderizados
        const cardsDestaFonte = document.querySelectorAll(`[data-source="${_menuSubAnotacaoCtx.viewSource}"] .sub-annotation-card`);
        const cardEditado = cardsDestaFonte[_menuSubAnotacaoCtx.localIndex];
        
        if (cardEditado) {
            cardEditado.classList.remove('card-flash-focus');
            void cardEditado.offsetWidth;
            cardEditado.classList.add('card-flash-focus');
        }
    });
    
    const rotulos = { 
        'comando': 'Comando Direto', 
        'texto': 'Texto Fixo', 
        'nota': 'Nota Oculta', 
        'premissa': 'Premissa Padrão',
        'veredito': 'Veredito / Conclusão',
        'fundamentacao': 'Lei Seca',
        'refutacao': 'Refutação (Mérito)',
        'preliminar': 'Filtro / Prejudicial',
        'jurisprudencia': 'Jurisprudência Exata',
        'degravacao': 'Degravação Curada'
    };
    exibirToast(`Classificado como: ${rotulos[intencaoStr]}`, 'sucesso');
    document.getElementById('sub-annotation-context-menu').style.display = 'none';
}

function _posicionarMenu(menuId, event) {
    const menu = document.getElementById(menuId);
    menu.style.display = 'flex'; menu.style.visibility = 'hidden';
    const { width: mW, height: mH } = menu.getBoundingClientRect();
    let x = event.clientX + 10; let y = event.clientY - 10;
    if (x + mW > window.innerWidth) x = window.innerWidth - mW - 8;
    if (y + mH > window.innerHeight) y = window.innerHeight - mH - 8;
    if (y < 0) y = 8; if (x < 0) x = 8;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    menu.style.visibility = 'visible';
}

/* --- MODAL DE EDIÇÃO E NEGRITO (MARKDOWN) --- */
function editarAnotacao() {
    if (!_menuAnotacaoCtx) return;
    const anotacao = topicos.find(t => t.id === _menuAnotacaoCtx.topicoId).anotacoes[_menuAnotacaoCtx.index];
    if (anotacao.tipo !== 'texto' && anotacao.tipo !== 'audio') return exibirToast('Apenas anotações de texto e áudio podem ser editadas.', 'aviso');

    let textoContexto = anotacao.conteudo;
    if (anotacao.tipo === 'audio') {
        try { const d = JSON.parse(anotacao.conteudo); textoContexto = d.transcricao || ''; } catch(e){}
    }
    abrirModalEdicao({ tipo: 'main', topicoId: _menuAnotacaoCtx.topicoId, parentIndex: _menuAnotacaoCtx.index, tipoAnotacao: anotacao.tipo }, textoContexto, anotacao.comentario);
    document.getElementById('annotation-context-menu').style.display = 'none';
}

function editarSubAnotacao() {
    if (!_menuSubAnotacaoCtx) return;
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const alvo = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
    const sub = alvo.subAnotacoes[_menuSubAnotacaoCtx.localIndex];
    
    abrirModalEdicao({ 
        tipo: 'sub', 
        topicoId: _menuSubAnotacaoCtx.topicoId, 
        parentIndex: _menuSubAnotacaoCtx.parentIndex, 
        viewSource: _menuSubAnotacaoCtx.viewSource,
        localIndex: _menuSubAnotacaoCtx.localIndex 
    }, sub.texto);
    document.getElementById('sub-annotation-context-menu').style.display = 'none';
}

function editarItemCorrelacionado() {
    if (!_menuAnotacaoCtx || _menuAnotacaoCtx.cIdx === undefined) return;
    const topico = topicos.find(t => t.id === _menuAnotacaoCtx.topicoId);
    const item = topico.anotacoes[_menuAnotacaoCtx.index].itensCorrelacionados[_menuAnotacaoCtx.cIdx];

    if (item.tipo !== 'texto' && item.tipo !== 'audio') return exibirToast('Apenas anotações de texto e áudio podem ser editadas.', 'aviso');

    let textoContexto = item.conteudo;
    if (item.tipo === 'audio') {
        try { const d = JSON.parse(item.conteudo); textoContexto = d.transcricao || ''; } catch(e){}
    }
    abrirModalEdicao({ tipo: 'correlated', topicoId: _menuAnotacaoCtx.topicoId, parentIndex: _menuAnotacaoCtx.index, cIdx: _menuAnotacaoCtx.cIdx, tipoAnotacao: item.tipo }, textoContexto, item.comentario);
}

let _editTriggerElement = null;

function abrirModalEdicao(contexto, textoAtual, comentarioAtual = '', tituloModal = null, placeholderText = null) {
    _editTriggerElement = document.activeElement;
    _editContext = contexto;
    _editContext.textoOriginal = textoAtual || '';
    _editContext.isDirty = false; // Flag crítica para o Guard

    const modal = document.getElementById('text-edit-modal');
    const editor = document.getElementById('edit-text-input');
    const commentArea = document.getElementById('edit-comentario-input');
    const toolbar = document.getElementById('edit-toolbar');
    const title = document.getElementById('edit-modal-title');
    const backdrop = document.getElementById('text-edit-backdrop');
    const isAudio = contexto.tipoAnotacao === 'audio';

    // Limpa qualquer altura inline residual deixada por resize manual anterior
    editor.style.height = '';

    // Aplica modificador dimensional específico quando for edição de Preâmbulo
    if (modal) {
        modal.classList.toggle('is-preambulo', contexto.tipo === 'preambulo');
    }

    // Monitoramento de alteração (Input Event)
    editor.oninput = () => { _editContext.isDirty = true; };
    if (commentArea) commentArea.oninput = () => { _editContext.isDirty = true; };

    if (isAudio) {
        editor.innerText = textoAtual || '';
        editor.dataset.placeholder = 'Degravação literal do áudio...';
        if (commentArea) {
            commentArea.value = comentarioAtual || '';
            commentArea.style.display = 'block';
        }
        if (toolbar) toolbar.style.display = 'none';
        title.innerHTML = tituloModal || '🎙️ Editar Áudio e Observação';
    } else {
        editor.innerHTML = window.JurisEditor.markdownParaHtml(textoAtual || '');
        editor.dataset.placeholder = placeholderText || 'Selecione um trecho e aplique formatação...';
        if (commentArea) {
            commentArea.value = comentarioAtual || '';
            commentArea.style.display = 'none';
        }
        if (toolbar) toolbar.style.display = 'flex';
        title.innerHTML = tituloModal || '✏️ Editar Texto';
    }

    editor.dispatchEvent(new Event('input')); // Reavalia placeholder
    backdrop.classList.add('is-visible');
    modal.style.display = 'flex';

    setTimeout(() => {
        editor.focus();
        if (typeof editor.scrollTop === 'number') editor.scrollTop = 0;
    }, 50);
}

window.toggleExpandirModalEdicao = function() {
    const modal = document.getElementById('text-edit-modal');
    const editor = document.getElementById('edit-text-input');
    const btn = document.getElementById('btn-expand-editor');
    const label = document.getElementById('btn-expand-editor-label');
    if (!modal || !editor) return;

    // Remove altura inline do resize manual para não conflitar com o Flexbox
    editor.style.height = '';

    const expandido = modal.classList.toggle('is-expanded');
    if (btn) btn.setAttribute('aria-pressed', expandido ? 'true' : 'false');
    if (label) label.textContent = expandido ? 'Restaurar' : 'Expandir';

    editor.focus();
};

// Guard de Perda de Dados
window.fecharModalEdicaoSeguro = function() {
    if (_editContext && _editContext.isDirty) {
        if (!confirm("Você tem alterações não salvas. Deseja realmente fechar e perder o rascunho?")) {
            document.getElementById('edit-text-input').focus();
            return;
        }
    }
    fecharModalEdicao();
};

function fecharModalEdicao() {
    _editContext = null;
    const backdrop = document.getElementById('text-edit-backdrop');
    const modal = document.getElementById('text-edit-modal');
    const editor = document.getElementById('edit-text-input');
    const btn = document.getElementById('btn-expand-editor');
    const label = document.getElementById('btn-expand-editor-label');

    backdrop.classList.remove('is-visible');
    if (editor) editor.style.height = '';
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('is-preambulo', 'is-expanded');
    }
    if (btn) btn.setAttribute('aria-pressed', 'false');
    if (label) label.textContent = 'Expandir';

    // Restaura o foco ao elemento original sem provocar salto de scroll na tela
    if (_editTriggerElement && typeof _editTriggerElement.focus === 'function') {
        try { _editTriggerElement.focus({ preventScroll: true }); } catch (e) {}
    }
    _editTriggerElement = null;
}

// Atalhos de Teclado (Ctrl+Enter e Esc)
window.handleModalEditorKeydown = function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        salvarEdicaoTexto();
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        fecharModalEdicaoSeguro();
    }
};

function aplicarNegritoTextarea() {
    const textarea = document.getElementById('edit-text-input');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const texto = textarea.value;

    if (start === end) return exibirToast('Selecione um trecho para aplicar o negrito.', 'aviso');
    
    // Envolve o texto com asteriscos duplos (Padrão Markdown seguro)
    const novoTexto = texto.substring(0, start) + '**' + texto.substring(start, end) + '**' + texto.substring(end);
    textarea.value = novoTexto;
    textarea.focus();
    textarea.setSelectionRange(start + 2, end + 2);
}

// Suporte ao Atalho Ctrl+B
document.getElementById('edit-text-input').addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        aplicarNegritoTextarea();
    }
});

function salvarEdicaoTexto() {
    if (!_editContext) return;
    const topico = topicos.find(t => t.id === _editContext.topicoId);
    if (!topico) return;

    const editor = document.getElementById('edit-text-input');
    const isAudio = _editContext.tipoAnotacao === 'audio';

    // FASE 1 & 2: EARLY RETURNS DE EXCEÇÕES (Preâmbulo e Áudio)
    if (_editContext.tipo === 'preambulo') {
        topico[_editContext.campo] = window.JurisEditor.htmlParaMarkdown(editor.innerHTML);
        renderizarTopicos(); salvarBackupAutomatico();
        exibirToast('Preâmbulo salvo.', 'sucesso');
        _editContext.isDirty = false;
        return fecharModalEdicao();
    }

    if (isAudio) {
        let alvo;
        if (_editContext.tipo === 'main') alvo = topico.anotacoes[_editContext.parentIndex];
        else if (_editContext.tipo === 'correlated') alvo = topico.anotacoes[_editContext.parentIndex].itensCorrelacionados[_editContext.cIdx];
        if (!alvo) return;

        const novoTextoAudio = editor.innerText.trim();
        const novoComentario = document.getElementById('edit-comentario-input').value.trim();
        try {
            const d = JSON.parse(alvo.conteudo);
            d.transcricao = novoTextoAudio;
            alvo.conteudo = JSON.stringify(d);
        } catch (e) { console.error('Erro de parse', e); }
        alvo.comentario = novoComentario;
        
        renderizarTopicos(); salvarBackupAutomatico();
        exibirToast('Áudio atualizado!', 'sucesso');
        _editContext.isDirty = false;
        return fecharModalEdicao();
    }

    // FASE 3: PIPELINE DE TEXTO COMUM E SANITIZAÇÃO
    let novoTexto = window.JurisEditor.htmlParaMarkdown(editor.innerHTML);
    const tiposPermitidosParaLimpeza = ['texto', 'sub', 'correlated'];
    if (tiposPermitidosParaLimpeza.includes(_editContext.tipo) || _editContext.tipoAnotacao === 'texto' || _editContext.acao === 'adicionar') {
        novoTexto = window.JurisUtils.limparTextoPDF(novoTexto);
    }

    // FASE 4: VALIDAÇÃO DE VAZIO (Apenas "main cards" impedem vazio na edição)
    if (_editContext.tipoAnotacao === 'texto' && _editContext.acao !== 'adicionar' && !novoTexto) {
        return exibirToast('O texto da prova não pode ficar vazio.', 'aviso');
    }

    // FASE 5: PERSISTÊNCIA (BIFURCAÇÃO ADD vs EDIT)
    if (_editContext.acao === 'adicionar') {
        if (!novoTexto) return exibirToast('Digite um conteúdo válido.', 'aviso');

        const noIdeia = {
            uuid: gerarUUIDSeguro(),
            texto: novoTexto,
            revisada: false,
            timestamp: Date.now()
        };

        // REGRA DE OURO DA SEMÂNTICA: Diretrizes ganham intenção; Sub-nós permanecem undefined.
        if (_editContext.tipoAdicao === 'diretriz') {
            noIdeia.intencao = 'premissa';
            if (_editContext.escopo === 'global') {
                if (!topico.diretrizesGlobais) topico.diretrizesGlobais = [];
                topico.diretrizesGlobais.push(noIdeia);
            } else if (_editContext.escopo === 'tese') {
                if (!topico.diretrizesPorTese) topico.diretrizesPorTese = {};
                if (!topico.diretrizesPorTese[_editContext.teseNome]) topico.diretrizesPorTese[_editContext.teseNome] = [];
                topico.diretrizesPorTese[_editContext.teseNome].push(noIdeia);
            }
        } else if (_editContext.tipoAdicao === 'sub') {
            const alvo = _resolverSubAlvo(topico, _editContext.parentIndex, _editContext.viewSource);
            if (!alvo.subAnotacoes) alvo.subAnotacoes = [];
            alvo.subAnotacoes.push(noIdeia);
        }
        exibirToast('Ideia adicionada com sucesso!', 'sucesso');
    } 
    else {
        // Fluxo padrão Editar Existente
        let alvo;
        if (_editContext.tipo === 'main') alvo = topico.anotacoes[_editContext.parentIndex];
        else if (_editContext.tipo === 'sub') alvo = _resolverSubAlvo(topico, _editContext.parentIndex, _editContext.viewSource).subAnotacoes[_editContext.localIndex];
        else if (_editContext.tipo === 'correlated') alvo = topico.anotacoes[_editContext.parentIndex].itensCorrelacionados[_editContext.cIdx];
        
        if (!alvo) return;
        
        if (_editContext.tipo === 'sub') alvo.texto = novoTexto;
        else alvo.conteudo = novoTexto;
        
        exibirToast('Anotação atualizada!', 'sucesso');
    }

    // FASE 6: COMMIT DE ESTADO
    renderizarTopicos();
    salvarBackupAutomatico();
    _editContext.isDirty = false; // Reseta o Guard
    fecharModalEdicao();
}

window.abrirEdicaoPreambulo = function(topicoId, campo) {
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico) return;
    const textoAtual = topico[campo] || '';

    const configCampos = {
        alegacoes: {
            titulo: '🗣️ Editar Razões Recursais',
            placeholder: 'Sintetize em 1 ou 2 parágrafos as alegações recursais da parte recorrente...'
        },
        fundamentos: {
            titulo: '🏛️ Editar Fundamentos da Origem',
            placeholder: 'Sintetize em 1 ou 2 parágrafos os fundamentos adotados pela sentença de origem...'
        },
        veredito: {
            titulo: '⭐ Editar Veredito / Conclusão',
            placeholder: 'Defina a conclusão/veredito para orientar a redação final deste tópico...'
        }
    };

    const cfg = configCampos[campo] || { titulo: '✏️ Editar Preâmbulo', placeholder: 'Digite o conteúdo...' };
    abrirModalEdicao(
        { tipo: 'preambulo', topicoId: topicoId, campo: campo },
        textoAtual,
        '',
        cfg.titulo,
        cfg.placeholder
    );
};

/* --- FUNÇÕES INTEGRAIS MIGRADAS DO APP.JS --- */
function acionarNovoNoIdeia() {
    if (!_menuAnotacaoCtx) return;
    // Captura segura, assumindo null caso acionado a partir de card principal
    const { topicoId, index } = _menuAnotacaoCtx;
    const cIdx = _menuAnotacaoCtx.cIdx ?? null; 
    
    document.getElementById('annotation-context-menu').style.display = 'none';
    adicionarSubAnotacao(topicoId, index, cIdx);
}

function excluirAnotacao() {
    if (!_menuAnotacaoCtx) return;
    const { topicoId, index } = _menuAnotacaoCtx;
    const topico = topicos.find(t => t.id === topicoId);
    const cardAlvo = topico.anotacoes[index];

    // Validação de impacto estrutural
    const temCorrelacionados = cardAlvo.itensCorrelacionados && cardAlvo.itensCorrelacionados.length > 0;
    const temSub = cardAlvo.subAnotacoes && cardAlvo.subAnotacoes.length > 0;

    if (temCorrelacionados) {
        const msg = '⚠️ ATENÇÃO: Esta prova é um Card Mestre e agrupa outros itens.\n\nDeseja excluir apenas esta prova principal e PROMOVER a próxima do grupo para assumir o seu lugar?';
        if (!confirm(msg)) return;

        // Clone profundo para evitar mutação cruzada (Garante a integridade do grupo)
        const cloneProfundo = structuredClone(cardAlvo);
        const novoMainCard = cloneProfundo.itensCorrelacionados.shift(); 
        
        // O herdeiro assume a tese e a tutela dos irmãos restantes
        novoMainCard.tese = cloneProfundo.tese; 
        novoMainCard.itensCorrelacionados = cloneProfundo.itensCorrelacionados;

        // 1. Mutação DIRETA na memória global (Garante o funcionamento sem depender do Store)
        topico.anotacoes[index] = novoMainCard;

        // 2. Despacho secundário (Mantém o log de estado se o Redux/Store estiver ativo)
        if (window.Store) {
            window.Store.dispatch({ type: 'UPDATE_ITEM', payload: { topicoId, index, novoItem: novoMainCard } });
        }
        
        exibirToast('Prova principal excluída. Item agrupado promovido a Mestre.', 'sucesso');
        
    } else {
        // Deleção Padrão
        let msg = 'Excluir esta prova? A ação não pode ser desfeita.';
        if (temSub) {
            msg = 'Excluir esta prova e todos os seus Nós de Ideia atrelados a ela?';
        }
        if (!confirm(msg)) return;

        // 1. Mutação DIRETA na memória global
        topico.anotacoes.splice(index, 1);

        // 2. Despacho secundário
        if (window.Store) {
            window.Store.dispatch({ type: 'DELETE_ITEM', payload: { topicoId, index } });
        }
        
        exibirToast('Anotação excluída com sucesso.', 'sucesso');
    }

    // A SOLUÇÃO DO BUG: Execução INCONDICIONAL
    // Fora de qualquer bloco "if". A tela repinta instantaneamente e reorganiza os números.
    renderizarTopicos(); 
    salvarBackupAutomatico();
    if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    
    // Limpeza rigorosa do menu contextual e ponteiros
    _menuAnotacaoCtx = null;
    const menuCtx = document.getElementById('annotation-context-menu');
    if (menuCtx) menuCtx.style.display = 'none';
}

let _reordenarCtx = null;

function reordenarAnotacao() {
    if (!_menuAnotacaoCtx) return;
    const { topicoId, index } = _menuAnotacaoCtx;
    const topico = topicos.find(t => t.id === topicoId);
    const validos = window.JurisIndexUtils.obterIndicesReaisValidos(topico.anotacoes);
    if (validos.length <= 1) return exibirToast('Apenas uma anotação existente.', 'aviso');

    abrirModalReordenar('main', topicoId, index, validos.length);
    document.getElementById('annotation-context-menu').style.display = 'none';
}

function excluirSubAnotacao() {
    if (!_menuSubAnotacaoCtx) return;
    if (!confirm('Excluir esta ideia secundária?')) return;
    
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const alvo = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
    
    alvo.subAnotacoes.splice(_menuSubAnotacaoCtx.localIndex, 1);
    
    renderizarTopicos(); salvarBackupAutomatico();
    document.getElementById('sub-annotation-context-menu').style.display = 'none';
}

/* ================================================
   1. ATUALIZAÇÃO: REORDENAÇÃO DE SUB-NÓS (Integração)
   ================================================ */

// Função acionada pelo novo botão no menu contextual
function acionarReordenarSub() {
    if (!_menuSubAnotacaoCtx) return;
    
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const alvo = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
    const total = alvo.subAnotacoes.length;
    
    if (total <= 1) return exibirToast('Apenas uma anotação existente neste grupo.', 'aviso');
    
    abrirModalReordenar('sub', _menuSubAnotacaoCtx.topicoId, _menuSubAnotacaoCtx.parentIndex, total, _menuSubAnotacaoCtx.localIndex);
    document.getElementById('sub-annotation-context-menu').style.display = 'none';
}

function abrirModalReordenar(tipo, topicoId, index, total, subIndex = null) {
    _reordenarCtx = { tipo, topicoId, index, total, subIndex };
    const topico = topicos.find(t => t.id === topicoId);
    const posAtual = tipo === 'main' 
        ? window.JurisIndexUtils.realParaVisual(topico.anotacoes, index) 
        : subIndex + 1;

    document.getElementById('input-nova-posicao').value = posAtual;
    document.getElementById('input-nova-posicao').max = total;

    document.getElementById('reordenar-modal-backdrop').style.display = 'block';
    document.getElementById('modal-reordenar').style.display = 'flex';
}

function fecharModalReordenar() {
    document.getElementById('reordenar-modal-backdrop').style.display = 'none';
    document.getElementById('modal-reordenar').style.display = 'none';
    _reordenarCtx = null;
}

function confirmarReordenacaoPosicao() {
    if (!_reordenarCtx) return;
    const topico = topicos.find(t => t.id === _reordenarCtx.topicoId);
    const novaPos = parseInt(document.getElementById('input-nova-posicao').value, 10);

    if (isNaN(novaPos) || novaPos < 1 || novaPos > _reordenarCtx.total) {
        return exibirToast(`Posição inválida. Escolha entre 1 e ${_reordenarCtx.total}.`, 'erro');
    }

    if (_reordenarCtx.tipo === 'main') {
        const [item] = topico.anotacoes.splice(_reordenarCtx.index, 1);
        const validosRestantes = window.JurisIndexUtils.obterIndicesReaisValidos(topico.anotacoes);
        let targetRealIdx;
        if (novaPos <= validosRestantes.length) {
            targetRealIdx = validosRestantes[novaPos - 1];
        } else {
            const idxSaida = topico.anotacoes.findIndex(a => a && a.tipo === 'checkpoint_saida');
            targetRealIdx = idxSaida !== -1 ? idxSaida : topico.anotacoes.length;
        }
        topico.anotacoes.splice(targetRealIdx, 0, item);
    } else if (_reordenarCtx.tipo === 'sub') {
        const alvo = _resolverSubAlvo(topico, _reordenarCtx.index, _menuSubAnotacaoCtx.viewSource);
        const [item] = alvo.subAnotacoes.splice(_reordenarCtx.subIndex, 1);
        alvo.subAnotacoes.splice(novaPos - 1, 0, item);
    }

    renderizarTopicos(); salvarBackupAutomatico();
    if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    fecharModalReordenar();
    exibirToast('Item reposicionado com sucesso.', 'sucesso');
    _menuAnotacaoCtx = null;
    _menuSubAnotacaoCtx = null;
}

/* ================================================
   2. NOVA FUNCIONALIDADE: TRANSFERÊNCIA INTELIGENTE
   ================================================ */

window.criarPilhaDeIdeias = function() {
    if (!_menuSubAnotacaoCtx) return;
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const alvo = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
    const sub = alvo.subAnotacoes[_menuSubAnotacaoCtx.localIndex];
    
    if (sub.grupoId) return exibirToast('Este nó já está agrupado.', 'aviso');

    sub.grupoId = 'grp-' + Date.now().toString(36);
    renderizarTopicos(); 
    salvarBackupAutomatico();
    document.getElementById('sub-annotation-context-menu').style.display = 'none';
    exibirToast('Pilha criada! Transfira outros nós para ela.', 'sucesso');
};

function abrirModalTransferirSubAnotacao() {
    if (!_menuSubAnotacaoCtx) return;
    document.getElementById('sub-annotation-context-menu').style.display = 'none';
    
    document.getElementById('input-transferir-sub-destino').value = '';
    document.getElementById('transfer-sub-target-box').style.display = 'none';
    document.getElementById('select-transferir-sub-alvo').innerHTML = '';
    
    document.getElementById('transferir-sub-backdrop').style.display = 'block';
    document.getElementById('modal-transferir-sub').style.display = 'flex';
    
    setTimeout(() => document.getElementById('input-transferir-sub-destino').focus(), 50);
}

function fecharModalTransferirSub() {
    document.getElementById('transferir-sub-backdrop').style.display = 'none';
    document.getElementById('modal-transferir-sub').style.display = 'none';
}

// Helper: Extrai um snippet seguro para montar os rótulos do select
function _gerarSnippetCard(item) {
    const docTag = item.documento || item.polo || 'Item não nomeado';
    let snippet = '';
    
    if (item.tipo === 'texto') {
        // Remove quebras de linha e limita a 25 caracteres
        const limpo = item.conteudo.replace(/<[^>]*>?/gm, '').substring(0, 25);
        snippet = `[T] "${limpo}..."`;
    } else if (item.tipo === 'audio') {
        snippet = `[Áudio]`;
    } else if (item.tipo === 'imagem') {
        snippet = `[Imagem]`;
    }
    return `${docTag} - ${snippet}`;
}

function carregarSubAlvosTransferencia() {
    if (!_menuSubAnotacaoCtx) return;
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const inputVal = parseInt(document.getElementById('input-transferir-sub-destino').value, 10);
    const targetBox = document.getElementById('transfer-sub-target-box');
    const select = document.getElementById('select-transferir-sub-alvo');
    
    select.innerHTML = '';
    targetBox.style.display = 'none';

    const validos = window.JurisIndexUtils.obterIndicesReaisValidos(topico.anotacoes);
    if (isNaN(inputVal) || inputVal < 1 || inputVal > validos.length) return;

    const destinoRealIdx = validos[inputVal - 1];
    const cardDestino = topico.anotacoes[destinoRealIdx];
    
    // Adiciona opções padrão (Mestre e Anexos) baseadas no card de destino
    if (cardDestino.itensCorrelacionados && cardDestino.itensCorrelacionados.length > 0) {
        select.appendChild(new Option(`🌟 Mestre: ${_gerarSnippetCard(cardDestino)}`, 'main'));
        cardDestino.itensCorrelacionados.forEach((item, idx) => {
            select.appendChild(new Option(`↳ Anexo: ${_gerarSnippetCard(item)}`, idx));
        });
    } else {
        select.appendChild(new Option(`🌟 Mestre: ${_gerarSnippetCard(cardDestino)}`, 'main'));
    }

    // NOVO: Mapeamento Global de Pilhas (Resolve o ponto cego de Teses e traz números Romanos precisos)
    const pilhasMapeadas = new Map();
    let contadorRomano = 0;
    const romanos = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];

    const registrarPilha = (subArr) => {
        if (!subArr) return;
        subArr.forEach(s => {
            if (s.grupoId && !pilhasMapeadas.has(s.grupoId)) {
                const rom = romanos[contadorRomano] || String(contadorRomano + 1);
                const label = s.grupoTitulo ? s.grupoTitulo : (s.texto ? s.texto.substring(0, 25) + '...' : 'Ideias Agrupadas');
                pilhasMapeadas.set(s.grupoId, { romano: rom, label: label });
                contadorRomano++;
            }
        });
    };

    // Varredura rigorosa respeitando a ordem visual da interface
    if (topico.anotacoes) {
        topico.anotacoes.forEach(an => {
            if (an.tese && topico.diretrizesPorTese && topico.diretrizesPorTese[an.tese]) {
                registrarPilha(topico.diretrizesPorTese[an.tese]);
            }
            registrarPilha(an.subAnotacoes);
            if (an.itensCorrelacionados) {
                an.itensCorrelacionados.forEach(ic => registrarPilha(ic.subAnotacoes));
            }
        });
    }
    registrarPilha(topico.diretrizesGlobais);

    if (pilhasMapeadas.size > 0) {
        const divider = document.createElement('option');
        divider.disabled = true; divider.text = "── Pilhas Existentes no Tópico ──";
        select.appendChild(divider);
        
        pilhasMapeadas.forEach((dados, grpId) => {
            select.appendChild(new Option(`📚 Pilha ${dados.romano} - "${dados.label}"`, `pilha|${grpId}`));
        });
    }
    
    targetBox.style.display = 'flex';
}

// Helper Privado: Localiza exatamente em qual gaveta (array) uma Pilha reside, prevenindo duplicação fantasma
function _encontrarArrayDoGrupo(topico, grupoId) {
    let arrayDestino = null;
    const varrer = (arr) => {
        if (arr && arr.some(s => s.grupoId === grupoId)) arrayDestino = arr;
    };

    varrer(topico.diretrizesGlobais);
    if (topico.diretrizesPorTese) Object.values(topico.diretrizesPorTese).forEach(varrer);
    
    if (topico.anotacoes && !arrayDestino) {
        topico.anotacoes.forEach(an => {
            if (!arrayDestino) varrer(an.subAnotacoes);
            if (an.itensCorrelacionados && !arrayDestino) {
                an.itensCorrelacionados.forEach(ic => varrer(ic.subAnotacoes));
            }
        });
    }
    return arrayDestino;
}

function confirmarTransferenciaSub() {
    if (!_menuSubAnotacaoCtx) return;
    const topico = topicos.find(t => t.id === _menuSubAnotacaoCtx.topicoId);
    const destinoTarget = parseInt(document.getElementById('input-transferir-sub-destino').value, 10);
    const validos = window.JurisIndexUtils.obterIndicesReaisValidos(topico.anotacoes);
    
    if (isNaN(destinoTarget) || destinoTarget < 1 || destinoTarget > validos.length) {
        return exibirToast(`Destino inválido. Escolha um número entre 1 e ${validos.length}.`, 'erro');
    }
    
    const destinoIndex = validos[destinoTarget - 1];
    const cardDestino = topico.anotacoes[destinoIndex];
    const selectVal = document.getElementById('select-transferir-sub-alvo').value;
    
    // Se o usuário selecionou enviar para uma Pilha
    if (selectVal.startsWith('pilha|')) {
        const grupoAlvo = selectVal.split('|')[1];
        const alvoOrigem = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
        
        // Localiza a matriz real onde a pilha já reside
        const arrayDestino = _encontrarArrayDoGrupo(topico, grupoAlvo);
        
        // Remove da origem
        const noTransferido = alvoOrigem.subAnotacoes.splice(_menuSubAnotacaoCtx.localIndex, 1)[0];
        
        // Aplica o ID do grupo
        noTransferido.grupoId = grupoAlvo;
        
        // Joga no array exato para manter a coesão estrutural e evitar duplicação
        if (arrayDestino) {
            arrayDestino.push(noTransferido);
        } else {
            // Fallback de segurança caso a pilha tenha sido corrompida
            if (!cardDestino.subAnotacoes) cardDestino.subAnotacoes = [];
            cardDestino.subAnotacoes.push(noTransferido);
        }
        
        fecharModalTransferirSub();
        renderizarTopicos();
        salvarBackupAutomatico();
        exibirToast('Nó empilhado com sucesso!', 'sucesso');
        _menuSubAnotacaoCtx = null;
        return;
    }
    
    // Fluxo Padrão (Mestre ou Anexo)
    let alvoFinal = cardDestino; 
    let alvoViewSource = 'main';
    if (selectVal !== 'main') {
        alvoViewSource = selectVal;
        alvoFinal = cardDestino.itensCorrelacionados[parseInt(selectVal, 10)];
    }

    const alvoOrigem = _resolverSubAlvo(topico, _menuSubAnotacaoCtx.parentIndex, _menuSubAnotacaoCtx.viewSource);
    
    if (destinoIndex === _menuSubAnotacaoCtx.parentIndex && alvoViewSource === String(_menuSubAnotacaoCtx.viewSource)) {
        fecharModalTransferirSub();
        return exibirToast('O nó já pertence a esta prova. Nenhuma alteração realizada.', 'aviso');
    }

    const noTransferido = alvoOrigem.subAnotacoes.splice(_menuSubAnotacaoCtx.localIndex, 1)[0];
    delete noTransferido.grupoId; // Remove grupoId se estiver sendo movido para fora de uma pilha
    
    if (!alvoFinal.subAnotacoes) alvoFinal.subAnotacoes = [];
    alvoFinal.subAnotacoes.push(noTransferido);
    
    fecharModalTransferirSub();
    renderizarTopicos();
    salvarBackupAutomatico();
    exibirToast(`Nó transferido com sucesso!`, 'sucesso');
    _menuSubAnotacaoCtx = null;
}

function excluirItemCorrelacionado(topicoId, parentIndex, correlacionadoIndex) {
    if (!confirm('Excluir este item correlacionado?')) return;
    topicos.find(t => t.id === topicoId).anotacoes[parentIndex].itensCorrelacionados.splice(correlacionadoIndex, 1);
    renderizarTopicos(); salvarBackupAutomatico();
    if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    exibirToast('Item correlacionado excluído.', 'sucesso');
}

function adicionarSubAnotacao(topicoId, anotacaoIndex, cIdx = null) {
    const viewSource = cIdx !== null ? cIdx : 'main';
    _editContext = { 
        acao: 'adicionar', 
        tipoAdicao: 'sub', 
        topicoId: topicoId, 
        parentIndex: anotacaoIndex, 
        viewSource: viewSource 
    };
    abrirModalEdicao(_editContext, '', '', '✨ Novo Nó de Ideia', 'Descreva o argumento ou observação...');
}

/* ================================================
   SISTEMA DE CLASSIFICAÇÃO E REDAÇÃO DE TESES
   ================================================ */
let _ideiaContextoTese = null;
let _autoTeseRequestId = 0; // Controle monotônico contra Race Conditions assíncronas

// Regex pré-compiladas em escopo de módulo (Hoisting para zero overhead no V8)
const _REGEX_TAGS_HTML_RESIDUAIS = /<[^>]*>/g;
const _REGEX_CPF_LGPD = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const _REGEX_CNPJ_LGPD = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const _REGEX_EMAIL_LGPD = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const _REGEX_TEL_LGPD = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\b9?\d{4}-?\d{4}\b/g;

function _sanitizarTextoParaIA(textoBruto, limiteCaracteres = 500) {
    if (!textoBruto || typeof textoBruto !== 'string') return '';

    // 1. Remove tags HTML residuais e limpa ruídos de PDF/Markdown
    let texto = textoBruto.replace(_REGEX_TAGS_HTML_RESIDUAIS, ' ');
    if (window.JurisUtils) {
        if (typeof window.JurisUtils.limparTextoPDF === 'function') {
            texto = window.JurisUtils.limparTextoPDF(texto);
        }
        if (typeof window.JurisUtils.limparEscapeMarkdown === 'function') {
            texto = window.JurisUtils.limparEscapeMarkdown(texto);
        }
    }

    // 2. Mascaramento automático de PII (LGPD: CPF, CNPJ, E-mail, Telefone)
    texto = texto
        .replace(_REGEX_CPF_LGPD, '[CPF OCULTADO]')
        .replace(_REGEX_CNPJ_LGPD, '[CNPJ OCULTADO]')
        .replace(_REGEX_EMAIL_LGPD, '[EMAIL OCULTADO]')
        .replace(_REGEX_TEL_LGPD, '[TELEFONE OCULTADO]');

    // 3. Integração com termos customizados do QuickRedactManager (se ativo na sessão)
    if (window.QuickRedactManager && typeof window.QuickRedactManager.aplicarFiltroEmTexto === 'function') {
        texto = window.QuickRedactManager.aplicarFiltroEmTexto(texto);
    } else {
        // Fallback: lê os chips ativos renderizados no painel LGPD caso a API interna varie
        const chipsAtivos = document.querySelectorAll('#lista-chips-lgpd .redact-chip');
        chipsAtivos.forEach(chip => {
            const termo = chip.firstChild?.textContent?.trim();
            if (termo && termo.length >= 2) {
                const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                texto = texto.replace(new RegExp(escapado, 'gi'), '[TERMO OCULTADO]');
            }
        });
    }

    // 4. Normalização de espaços e truncamento seguro de janela de contexto
    texto = texto.replace(/\s+/g, ' ').trim();
    return texto.length > limiteCaracteres ? texto.substring(0, limiteCaracteres) + '...' : texto;
}

function _extrairResumoBlocoParaAutoTese(cardMestre, nomeTopico) {
    const linhas = [`Tópico Processual: ${_sanitizarTextoParaIA(nomeTopico || 'Geral', 120)}`];
    let possuiConteudoUtil = false;

    const extrairDeCard = (card, rotulo) => {
        const doc = _sanitizarTextoParaIA(card.documento || 'Documento', 80);
        const polo = card.polo ? ` | Polo/Origem: ${_sanitizarTextoParaIA(card.polo, 60)}` : '';
        linhas.push(`\n[${rotulo} — Peça: ${doc}${polo}]`);

        if (card.tipo === 'texto' && card.conteudo) {
            const trecho = _sanitizarTextoParaIA(card.conteudo, 550);
            if (trecho) {
                linhas.push(`Trecho extraído: "${trecho}"`);
                possuiConteudoUtil = true;
            }
        } else if (card.tipo === 'audio' && card.conteudo) {
            try {
                const d = JSON.parse(card.conteudo);
                if (d.orador) linhas.push(`Orador: ${_sanitizarTextoParaIA(d.orador, 80)}`);
                if (d.transcricao) {
                    const deg = _sanitizarTextoParaIA(d.transcricao, 500);
                    if (deg) {
                        linhas.push(`Degravação: "${deg}"`);
                        possuiConteudoUtil = true;
                    }
                }
            } catch (e) {}
        }

        if (card.comentario) {
            const obs = _sanitizarTextoParaIA(card.comentario, 350);
            if (obs) {
                linhas.push(`Observação do Assessor: "${obs}"`);
                possuiConteudoUtil = true;
            }
        }

        if (Array.isArray(card.subAnotacoes) && card.subAnotacoes.length > 0) {
            card.subAnotacoes.forEach((sub, idx) => {
                // Trava ética: ignora estritamente Notas Internas Ocultas (intencao === 'nota')
                if (sub.intencao !== 'nota' && sub.texto) {
                    const textoSub = _sanitizarTextoParaIA(sub.texto, 380);
                    if (textoSub) {
                        const tagIntencao = sub.intencao ? `[${sub.intencao.toUpperCase()}] ` : '';
                        linhas.push(`  -> Nó de Ideia ${idx + 1}: ${tagIntencao}${textoSub}`);
                        possuiConteudoUtil = true;
                    }
                }
            });
        }
    };

    extrairDeCard(cardMestre, 'Card Principal');

    if (Array.isArray(cardMestre.itensCorrelacionados) && cardMestre.itensCorrelacionados.length > 0) {
        // Limita a leitura aos primeiros 5 itens correlacionados para proteger o orçamento de tokens
        cardMestre.itensCorrelacionados.slice(0, 5).forEach((corr, idx) => {
            extrairDeCard(corr, `Prova Agrupada ${idx + 1}`);
        });
    }

    return possuiConteudoUtil ? linhas.join('\n') : '';
}

function _restaurarEstadoBotaoAutoTese() {
    const btnIA = document.getElementById('btn-auto-tese-ia');
    if (!btnIA) return;
    btnIA.classList.remove('is-thinking');
    btnIA.disabled = false;
    const txtBtn = btnIA.querySelector('.btn-auto-tese-text');
    if (txtBtn) txtBtn.textContent = '✨ Sugerir com IA';
}

function _aplicarVisualBotaoTese(chave) {
    const btn = document.getElementById('btn-classificacao-tese');
    const iconSpan = document.getElementById('icone-classificacao-tese');
    const textSpan = document.getElementById('texto-classificacao-tese');
    
    if (!btn || !window.TopicsManager || !TopicsManager.MAPA_TESE_ICONES) {
        console.warn('[Tese] TopicsManager.MAPA_TESE_ICONES não disponível.');
        return;
    }
    
    const config = TopicsManager.MAPA_TESE_ICONES[chave] || TopicsManager.MAPA_TESE_ICONES['neutro'];
    
    btn.dataset.classificacao = chave;
    btn.title = config.title;
    
    if (iconSpan) {
        iconSpan.className = `tese-icon-circle ${config.classeCss}`;
        iconSpan.innerHTML = `<svg><use href="${config.spriteId}"></use></svg>`;
    }
    
    if (textSpan) {
        textSpan.textContent = config.label;
        textSpan.style.color = config.textColor;
    }
}

window.ciclarClassificacaoTese = function(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    const btn = document.getElementById('btn-classificacao-tese');
    if (!btn || !window.TopicsManager || !TopicsManager.MAPA_TESE_ICONES) {
        console.warn('[Tese] Não foi possível ciclar: TopicsManager não disponível.');
        return;
    }
    
    const ordem = ['neutro', 'autora', 're', 'juizo'];
    const classeAtual = btn.dataset.classificacao || 'neutro';
    const proxIndex = (ordem.indexOf(classeAtual) + 1) % ordem.length;
    const novaClasse = ordem[proxIndex];
    
    _aplicarVisualBotaoTese(novaClasse);
    
    const iconSpan = document.getElementById('icone-classificacao-tese');
    if (iconSpan) {
        iconSpan.style.transform = 'scale(0.8)';
        setTimeout(() => {
            iconSpan.style.transform = 'scale(1)';
        }, 100);
    }
};

window.acionarAutoTeseIA = async function(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!_ideiaContextoTese) return;

    // Snapshot imutável de contexto e geração do token de sessão contra Race Conditions
    const snapshotTopicoId = _ideiaContextoTese.topicoId;
    const snapshotIndex = _ideiaContextoTese.index;
    const currentReqId = ++_autoTeseRequestId;

    const topico = topicos.find(t => t.id === snapshotTopicoId);
    if (!topico || !topico.anotacoes[snapshotIndex]) return;

    if (!window.AIRecommendationManager || typeof window.AIRecommendationManager.gerarAutoTese !== 'function') {
        return exibirToast('Serviço de IA não está disponível.', 'erro');
    }

    const cardMestre = topico.anotacoes[snapshotIndex];
    const contextoSanitizado = _extrairResumoBlocoParaAutoTese(cardMestre, topico.nome);

    if (!contextoSanitizado) {
        return exibirToast('Adicione um trecho de texto, observação ou nó de ideia antes de pedir sugestão à IA.', 'aviso');
    }

    const btnIA = document.getElementById('btn-auto-tese-ia');
    const txtBtn = btnIA ? btnIA.querySelector('.btn-auto-tese-text') : null;

    if (btnIA) {
        btnIA.classList.add('is-thinking');
        btnIA.disabled = true;
    }
    if (txtBtn) txtBtn.textContent = 'Analisando bloco...';

    try {
        const resultado = await window.AIRecommendationManager.gerarAutoTese(contextoSanitizado);

        // GUARD CLAUSE CRÍTICO: Verifica se o modal continua aberto para o MESMO card e na MESMA requisição
        const modalEl = document.getElementById('modal-editar-tese');
        const modalContinuaAberto = modalEl && modalEl.style.display === 'flex';
        const contextoIntacto = _ideiaContextoTese &&
                                _ideiaContextoTese.topicoId === snapshotTopicoId &&
                                _ideiaContextoTese.index === snapshotIndex;

        if (currentReqId !== _autoTeseRequestId || !modalContinuaAberto || !contextoIntacto) {
            return; // Aborta silenciosamente: o usuário fechou ou trocou de card
        }

        const textarea = document.getElementById('input-texto-tese');
        if (resultado.tese && textarea) {
            textarea.value = resultado.tese;
            textarea.classList.remove('card-flash-focus');
            void textarea.offsetWidth;
            textarea.classList.add('card-flash-focus');
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }

        if (resultado.classificacao) {
            _aplicarVisualBotaoTese(resultado.classificacao);
            const iconSpan = document.getElementById('icone-classificacao-tese');
            if (iconSpan) {
                iconSpan.style.transform = 'scale(1.22)';
                setTimeout(() => { iconSpan.style.transform = 'scale(1)'; }, 180);
            }
        }

        exibirToast('Tese e classificação sugeridas pela IA! ✨', 'sucesso');
    } catch (err) {
        if (currentReqId !== _autoTeseRequestId) return;
        console.warn('[Auto-Tese IA]', err);
        exibirToast(err.message || 'Falha ao gerar sugestão de tese.', 'erro');
    } finally {
        if (currentReqId === _autoTeseRequestId) {
            _restaurarEstadoBotaoAutoTese();
        }
    }
};

window.handleModalTeseKeydown = function(event) {
    // Ctrl+Enter ou Cmd+Enter salva imediatamente a tese
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        salvarTese();
        return;
    }
    // Alt+S dispara a sugestão com IA sem tirar a mão do teclado
    if (event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        acionarAutoTeseIA(event);
        return;
    }
    // Escape fecha o modal e cancela requisições pendentes
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        fecharModalTese();
    }
};

function abrirModalTese(topicoId, index) {
    _autoTeseRequestId++; // Invalida qualquer requisição anterior pendurada
    _restaurarEstadoBotaoAutoTese();

    _ideiaContextoTese = { topicoId, index };
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico || !topico.anotacoes[index]) return;

    const anotacao = topico.anotacoes[index];
    
    // Exibe o número visual real da Ideia (e não index + 1 que contava o checkpoint)
    document.getElementById('tese-ideia-num').textContent = window.JurisIndexUtils
        ? window.JurisIndexUtils.realParaVisual(topico.anotacoes, index)
        : (index + 1);
    
    const textarea = document.getElementById('input-texto-tese');
    textarea.value = anotacao.tese || '';
    
    _aplicarVisualBotaoTese(anotacao.teseClassificacao || 'neutro');
    
    document.getElementById('wizard-backdrop').style.display = 'block';
    document.getElementById('modal-editar-tese').style.display = 'flex';
    
    setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 50);
}

function fecharModalTese() {
    _autoTeseRequestId++; // Invalida imediatamente qualquer Promise da IA em voo
    _restaurarEstadoBotaoAutoTese();

    document.getElementById('wizard-backdrop').style.display = 'none';
    document.getElementById('modal-editar-tese').style.display = 'none';
    _ideiaContextoTese = null;
}

function salvarTese() {
    if (!_ideiaContextoTese) return;
    _autoTeseRequestId++; // Cancela respostas tardias caso o usuário salve manualmente antes da IA responder

    const topico = topicos.find(t => t.id === _ideiaContextoTese.topicoId);
    if (!topico || !topico.anotacoes[_ideiaContextoTese.index]) return;
    
    const textoTese = document.getElementById('input-texto-tese').value.trim();
    const classificacao = document.getElementById('btn-classificacao-tese').dataset.classificacao;
    
    topico.anotacoes[_ideiaContextoTese.index].tese = textoTese;
    topico.anotacoes[_ideiaContextoTese.index].teseClassificacao = classificacao;
    
    renderizarTopicos(); 
    salvarBackupAutomatico();
    
    exibirToast('Tese recursal atualizada com sucesso!', 'sucesso');
    fecharModalTese();
}

/* --- MODAL DE SMART MOVE (REORDENAÇÃO INTELIGENTE) --- */
let _smartMoveCtx = null;

function toggleSmartMoveInput() {
    const isExistente = document.querySelector('input[name="smart_move_tipo"]:checked').value === 'existente';
    const input = document.getElementById('input-smart-move-destino');
    const hint = document.getElementById('smart-move-hint');
    
    input.style.display = 'block'; // Garante que fique visível
    input.value = ''; // Limpa o valor ao trocar a opção
    
    if (isExistente) {
        input.placeholder = "Nº da Ideia Destino (ex: 2)";
        hint.innerText = "Digite o número da ideia onde esta prova será agrupada:";
    } else {
        input.placeholder = "Nova Posição (opcional)";
        hint.innerText = "Deixe em branco para ir para o final, ou digite a posição exata:";
    }
}

function abrirModalSmartMove(topicoId, parentIndex, correlacionadoIndex = null) {
    _smartMoveCtx = { topicoId, parentIndex, correlacionadoIndex };
    document.getElementById('input-smart-move-destino').value = '';
    document.querySelector('input[name="smart_move_tipo"][value="nova"]').checked = true;
    toggleSmartMoveInput();
    
    document.getElementById('wizard-backdrop').style.display = 'block';
    document.getElementById('modal-smart-move').style.display = 'flex';
}

function fecharModalSmartMove() {
    document.getElementById('wizard-backdrop').style.display = 'none';
    document.getElementById('modal-smart-move').style.display = 'none';
    _smartMoveCtx = null;
}

function confirmarSmartMove() {
    const topico = topicos.find(t => t.id === _smartMoveCtx.topicoId);
    const isNova = document.querySelector('input[name="smart_move_tipo"]:checked').value === 'nova';
    const inputVal = document.getElementById('input-smart-move-destino').value;
    const validos = window.JurisIndexUtils.obterIndicesReaisValidos(topico.anotacoes);
    let destinoVisual = null;
    let destinoIdx = null;

    // 1. Validação baseada estritamente nas ideias visuais válidas (ignorando checkpoints)
    if (!isNova) {
        const destinoVal = parseInt(inputVal, 10);
        if (isNaN(destinoVal) || destinoVal < 1 || destinoVal > validos.length) {
            return exibirToast(`Número de destino inválido. Escolha entre 1 e ${validos.length}.`, 'erro');
        }
        destinoIdx = validos[destinoVal - 1];
        if (_smartMoveCtx.correlacionadoIndex === null && destinoIdx === _smartMoveCtx.parentIndex) {
            return exibirToast('Não é possível mover a ideia para ela mesma.', 'erro');
        }
    } else {
        if (inputVal.trim() !== '') {
            const destinoVal = parseInt(inputVal, 10);
            if (isNaN(destinoVal) || destinoVal < 1 || destinoVal > validos.length + 1) {
                return exibirToast('Posição para a nova ideia é inválida.', 'erro');
            }
            destinoVisual = destinoVal;
        }
    }

    // 2. Extração da Prova da sua Origem Original (Operação Isolada)
    let itemMovido;
    let arrayReduziu = false;

    if (_smartMoveCtx.correlacionadoIndex !== null) {
        itemMovido = topico.anotacoes[_smartMoveCtx.parentIndex].itensCorrelacionados.splice(_smartMoveCtx.correlacionadoIndex, 1)[0];
    } else {
        const cardOriginal = topico.anotacoes[_smartMoveCtx.parentIndex];

        if (cardOriginal.itensCorrelacionados && cardOriginal.itensCorrelacionados.length > 0) {
            const cloneProfundo = structuredClone(cardOriginal);
            const novoMainCard = cloneProfundo.itensCorrelacionados.shift();
            novoMainCard.tese = cloneProfundo.tese;
            novoMainCard.itensCorrelacionados = cloneProfundo.itensCorrelacionados;

            itemMovido = structuredClone(cardOriginal);
            itemMovido.itensCorrelacionados = [];
            itemMovido.tese = ""; 

            topico.anotacoes[_smartMoveCtx.parentIndex] = novoMainCard;
            arrayReduziu = false;
        } else {
            itemMovido = topico.anotacoes.splice(_smartMoveCtx.parentIndex, 1)[0];
            arrayReduziu = true;
        }
    }

    // Compensação de índice real quando o array encolheu (para o modo Agrupar em Existente)
    if (arrayReduziu && _smartMoveCtx.correlacionadoIndex === null && !isNova && destinoIdx > _smartMoveCtx.parentIndex) {
        destinoIdx--;
    }

    // 3. Inserção no Destino Final respeitando fronteiras de Checkpoint
    if (isNova) {
        if (!itemMovido.itensCorrelacionados) itemMovido.itensCorrelacionados = [];
        if (!itemMovido.subAnotacoes) itemMovido.subAnotacoes = [];
        
        const validosAposExtracao = window.JurisIndexUtils.obterIndicesReaisValidos(topico.anotacoes);
        const idxSaida = topico.anotacoes.findIndex(a => a && a.tipo === 'checkpoint_saida');
        const posFinalSegura = idxSaida !== -1 ? idxSaida : topico.anotacoes.length;

        if (destinoVisual !== null) {
            const realInsertIdx = (destinoVisual <= validosAposExtracao.length)
                ? validosAposExtracao[destinoVisual - 1]
                : posFinalSegura;
            topico.anotacoes.splice(realInsertIdx, 0, itemMovido);
            const posConfirmada = window.JurisIndexUtils.realParaVisual(topico.anotacoes, realInsertIdx);
            exibirToast(`Prova transformada em Nova Ideia na posição ${posConfirmada}.`, 'sucesso');
        } else {
            topico.anotacoes.splice(posFinalSegura, 0, itemMovido);
            exibirToast('Prova transformada em Nova Ideia no final.', 'sucesso');
        }
    } else {
        const cardDestino = topico.anotacoes[destinoIdx];
        if (!cardDestino.itensCorrelacionados) cardDestino.itensCorrelacionados = [];
        cardDestino.itensCorrelacionados.push(itemMovido);
        const numVisualDestino = window.JurisIndexUtils.realParaVisual(topico.anotacoes, destinoIdx);
        exibirToast(`Prova agrupada à Ideia ${numVisualDestino}.`, 'sucesso');
    }

    renderizarTopicos(); 
    salvarBackupAutomatico(); 
    if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    fecharModalSmartMove();
}

/* --- TEMA E DRAG & DROP --- */
window.toggleSubmenuTemas = function() {
    const submenu = document.getElementById('submenu-temas');
    submenu.style.display = submenu.style.display === 'none' ? 'flex' : 'none';
};

window.DnDManager = {
    draggedItem: null,

    dragStart: function(event, topicoId, parentIndex, cIdx) {
        event.stopPropagation(); // CRÍTICO: Isola o evento de Bubbling do DOM
        this.draggedItem = { topicoId, parentIndex, cIdx };
        
        // Aplica o feedback visual no container correspondente
        const wrapper = cIdx === 'main' 
            ? event.currentTarget.closest('.main-card-wrapper')
            : event.currentTarget.closest('.correlated-item-wrapper');
            
        if (wrapper) wrapper.classList.add('dragging'); 
        
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', ''); // Necessário p/ Firefox
    },

    dragOver: function(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    },

    dragEnter: function(event) {
        event.preventDefault();
        event.stopPropagation(); // Bloqueia Bubbling
        const wrapper = event.currentTarget.closest('.correlated-item-wrapper') || event.currentTarget.closest('.main-card-wrapper');
        if (wrapper) wrapper.classList.add('drag-over');
    },

    dragLeave: function(event) {
        event.stopPropagation(); // Bloqueia Bubbling
        const wrapper = event.currentTarget.closest('.correlated-item-wrapper') || event.currentTarget.closest('.main-card-wrapper');
        if (!wrapper) return;
        // Evita o efeito pisca-pisca caso o mouse passe por elementos internos
        if (!wrapper.contains(event.relatedTarget)) {
            wrapper.classList.remove('drag-over');
        }
    },

    dragEnd: function(event) {
        event.currentTarget.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    },

    drop: function(event, targetTopicoId, targetParentIndex, targetCIdx) {
        event.preventDefault();
        event.stopPropagation(); // CRÍTICO: Bloqueia acionamento de áreas parentais

        const wrapper = event.currentTarget.closest('.correlated-item-wrapper') || event.currentTarget.closest('.main-card-wrapper');
        if (wrapper) wrapper.classList.remove('drag-over');

        const src = this.draggedItem;
        if (!src || src.topicoId !== targetTopicoId || src.parentIndex !== targetParentIndex) {
            exibirToast('Só é possível reordenar itens dentro do mesmo agrupamento.', 'aviso');
            return;
        }
        if (src.cIdx === targetCIdx) return; // Nenhuma movimentação real

        const topico = topicos.find(t => t.id === targetTopicoId);
        const cardOriginal = topico.anotacoes[targetParentIndex];
        
        if (targetCIdx === 'main' && src.cIdx !== null && src.cIdx !== 'main') {
            // FLUXO 1: PROMOVER FILHO A MESTRE (Arrastar de baixo para cima)
            const estadoClonado = structuredClone(cardOriginal);
            const itemArrastado = estadoClonado.itensCorrelacionados.splice(src.cIdx, 1)[0];
            
            const oldMain = structuredClone(estadoClonado);
            oldMain.itensCorrelacionados = []; oldMain.tese = "";
            
            estadoClonado.itensCorrelacionados.unshift(oldMain);
            
            itemArrastado.itensCorrelacionados = estadoClonado.itensCorrelacionados;
            itemArrastado.tese = estadoClonado.tese;

            topico.anotacoes[targetParentIndex] = itemArrastado;
            exibirToast('Prova promovida a Card Principal!', 'sucesso');
            
        } else if (src.cIdx === 'main' && targetCIdx !== 'main' && targetCIdx !== null) {
            // FLUXO 2: REBAIXAR MESTRE A FILHO (Arrastar mestre para baixo)
            const estadoClonado = structuredClone(cardOriginal);
            const novoMestre = estadoClonado.itensCorrelacionados.splice(targetCIdx, 1)[0];
            
            const oldMain = structuredClone(estadoClonado);
            oldMain.itensCorrelacionados = []; oldMain.tese = "";
            
            novoMestre.itensCorrelacionados = estadoClonado.itensCorrelacionados;
            novoMestre.tese = estadoClonado.tese;
            
            novoMestre.itensCorrelacionados.splice(targetCIdx, 0, oldMain);
            
            topico.anotacoes[targetParentIndex] = novoMestre;
            exibirToast('Card Mestre substituído!', 'sucesso');
            
        } else {
            // FLUXO 3: REORDENAÇÃO ENTRE FILHOS
            const grupo = cardOriginal.itensCorrelacionados;
            const [itemMovido] = grupo.splice(src.cIdx, 1);
            grupo.splice(targetCIdx, 0, itemMovido);
            exibirToast('Ordem atualizada!', 'sucesso');
        }

        renderizarTopicos();
        salvarBackupAutomatico();
        if (window.sincronizarHighlightsGerais) window.sincronizarHighlightsGerais();
    }
};

function exibirTooltipRapido(intencao, event) {
    // Encapsulado para não poluir o namespace global
    const RESUMOS_IA = {
        'premissa': { titulo: 'Premissa Lógica', texto: 'A IA usará isso como verdade absoluta para deduzir o caso.' },
        'comando': { titulo: 'Comando Direto', texto: 'A IA obedecerá a esta ordem exata na hora de redigir.' },
        'texto': { titulo: 'Texto Fixo', texto: 'A IA fará um "copia e cola" desta redação na minuta.' },
        'nota': { titulo: 'Nota Oculta', texto: 'A IA NÃO lerá isso. É apenas um lembrete para você.' },
        'veredito': { titulo: 'Veredito / Conclusão', texto: 'Força a IA a concluir o tópico recursal com esta decisão.' },
        'fundamentacao': { titulo: 'Lei Seca', texto: 'A IA fará a transcrição exata da norma e a conectará aos fatos nesta exata posição da narrativa.' },
        'refutacao': { titulo: 'Refutação (Mérito)', texto: 'A IA usará este argumento para derrubar a tese da parte.' },
        'preliminar': { titulo: 'Filtro / Prejudicial', texto: 'A IA redigirá este tópico antes de entrar no mérito.' },
        'jurisprudencia': { titulo: 'Jurisprudência', texto: 'A IA colará a ementa exata e a conectará ao argumento principal do caso.' },
        'degravacao': { titulo: 'Degravação (Recorte)', texto: 'A IA destacará esta fala exata como a prova oral cabal da tese.' }
    };

    const dados = RESUMOS_IA[intencao];
    if (!dados) return;

    const tooltip = document.getElementById('quick-intent-tooltip');
    tooltip.innerHTML = `<strong>${dados.titulo}</strong>${dados.texto}`;

    // Posicionamento Anti-Race-Condition: Bloqueia display antes de medir
    tooltip.classList.remove('visible');
    tooltip.style.display = 'block';

    let x = event.clientX + 15;
    let y = event.clientY + 15;
    const rect = tooltip.getBoundingClientRect();

    if (x + rect.width > window.innerWidth) x = event.clientX - rect.width - 15;
    if (y + rect.height > window.innerHeight) y = event.clientY - rect.height - 15;

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;

    // Dispara a animação apenas no próximo frame
    requestAnimationFrame(() => {
        tooltip.classList.add('visible');
    });

    clearTimeout(tooltip._timer);
    tooltip._timer = setTimeout(() => fecharTooltipRapido(), 4500);
}

function fecharTooltipRapido() {
    const tooltip = document.getElementById('quick-intent-tooltip');
    if (tooltip && tooltip.classList.contains('visible')) {
        tooltip.classList.remove('visible');
        setTimeout(() => { tooltip.style.display = 'none'; }, 200);
    }
}

window.adicionarCitacaoExpressa = function(topicoId, parentIndex, cIdx) {
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico) return;

    // 1. Resolve o Alvo: Card Mestre ou Item Correlacionado
    const cardMestre = topico.anotacoes[parentIndex];
    const alvo = (cIdx !== null && cIdx !== undefined) 
        ? cardMestre.itensCorrelacionados[cIdx] 
        : cardMestre;
    
    // 2. Extração segura dos metadados do alvo correto
    const docNome = alvo.documento || alvo.polo || 'Documento';
    const idInfo = alvo.pjeId || 'não informado';
    const flInfo = alvo.pagina || 'não informada';
    
    // 3. SANITIZAÇÃO CRÍTICA (Evita Prompt Injection e quebra de Markdown)
    let textoCru = alvo.conteudo || "";
    if (window.JurisUtils && window.JurisUtils.limparTextoPDF) {
        textoCru = window.JurisUtils.limparTextoPDF(textoCru);
    }
    textoCru = textoCru.replace(/\n/g, ' ').replace(/"/g, "'");

    // 4. Engenharia de Prompt
    const comandoLiteral = `Transcreva expressamente o trecho do documento **${docNome}** (Id. ${idInfo} - fl. ${flInfo}), inserindo a seguinte citação literal entre aspas e em itálico:\n\n*"${textoCru}"*`;

    // 5. Criação do Objeto "Nó de Ideia" classificado como Comando
    const novoNoComando = {
        uuid: gerarUUIDSeguro(),
        texto: comandoLiteral,
        intencao: 'comando', 
        revisada: false,
        timestamp: Date.now()
    };

    // 6. Mutação de Estado (Sempre ancorado ao alvo específico extraído)
    if (!alvo.subAnotacoes) alvo.subAnotacoes = [];
    alvo.subAnotacoes.push(novoNoComando);

    // 7. Commit e Re-renderização
    renderizarTopicos();
    if(window.salvarBackupAutomatico) salvarBackupAutomatico();
    if(window.exibirToast) exibirToast('Citação expressa vinculada ao Card!', 'sucesso');

    // 8. MICROINTERAÇÃO DE UX (Scroll Suave e Destaque Visual)
    window.JurisUX.scrollToLastSubNode(`timeline-wrapper-${cardMestre.uuid || parentIndex}`);
};

// ================================================
// HELPER DE MICROINTERAÇÃO GLOBAL (JURIS UX)
// ================================================
window.JurisUX = window.JurisUX || {};
window.JurisUX.scrollToLastSubNode = function(masterWrapperId) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const masterWrapper = document.getElementById(masterWrapperId);
            if (!masterWrapper) return;

            const subNodes = masterWrapper.querySelectorAll('.sub-annotations-wrapper .sub-annotation-item');
            if (subNodes.length === 0) return;
            const targetNode = subNodes[subNodes.length - 1];
            
            const scrollContainer = document.getElementById('history-container');
            if (targetNode && scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const targetRect = targetNode.getBoundingClientRect();
                const offset = (targetRect.top - containerRect.top) + scrollContainer.scrollTop - 20;
                
                scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });
                
                const innerCard = targetNode.querySelector('.sub-annotation-card');
                if (innerCard) {
                    innerCard.classList.remove('card-flash-focus');
                    void innerCard.offsetWidth;
                    innerCard.classList.add('card-flash-focus');
                }
            }
        });
    });
};

// ================================================
// FUNÇÃO GLOBAL: DEGRAVAÇÃO EXPRESSA
// ================================================
window.adicionarDegravacaoExpressa = function(topicoId, parentIndex, cIdx) {
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico) return;

    const cardMestre = topico.anotacoes[parentIndex];
    const alvo = (cIdx !== null && cIdx !== undefined) 
        ? cardMestre.itensCorrelacionados[cIdx] 
        : cardMestre;
    
    if (alvo.tipo !== 'audio') return;

    if (!window.TopicsManager || typeof window.TopicsManager.obterDadosAudioSeguros !== 'function') {
        if(window.exibirToast) exibirToast('Erro: Módulo de áudio não acessível.', 'erro');
        return;
    }

    const dadosAudio = window.TopicsManager.obterDadosAudioSeguros(alvo);

    if (!dadosAudio || dadosAudio.isCorrompido) {
        if(window.exibirToast) exibirToast('Áudio corrompido ou sem dados legíveis.', 'erro');
        return;
    }

    if (!dadosAudio.transcricao || !dadosAudio.transcricao.trim()) {
        if(window.exibirToast) exibirToast('Aviso: Este áudio não possui degravação salva para ser citada.', 'aviso');
        return;
    }

    let textoSeguro = dadosAudio.transcricao.replace(/\n/g, ' ').replace(/"/g, "'").trim();
    if (window.JurisUtils && window.JurisUtils.limparTextoPDF) {
        textoSeguro = window.JurisUtils.limparTextoPDF(textoSeguro);
    }

    const docNome = alvo.documento || alvo.polo || 'Ata de Audiência';
    const orador = dadosAudio.orador || "Orador";
    const tempoFormatado = dadosAudio.rotuloTempo || "Tempo indefinido";

    const comandoLiteral = `Transcreva expressamente o trecho do depoimento de **${orador}** (${docNome}), conforme extraído do registro audiovisual (${tempoFormatado}), inserindo a seguinte citação literal entre aspas e em itálico:\n\n*"${textoSeguro}"*`;

    const novoNoComando = {
        uuid: gerarUUIDSeguro(),
        texto: comandoLiteral,
        intencao: 'degravacao', 
        revisada: false,
        timestamp: Date.now()
    };

    if (!alvo.subAnotacoes) alvo.subAnotacoes = [];
    alvo.subAnotacoes.push(novoNoComando);

    renderizarTopicos();
    if(window.salvarBackupAutomatico) salvarBackupAutomatico();
    if(window.exibirToast) exibirToast('Degravação expressa vinculada à oitiva!', 'sucesso');

    window.JurisUX.scrollToLastSubNode(`timeline-wrapper-${cardMestre.uuid || parentIndex}`);
};

// NOVO: Função Global e Segura de Cópia da Degravação
window.copiarDegravacao = function(topicoId, uuidCard) {
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico) return;
    
    let alvo = topico.anotacoes.find(a => a.uuid === uuidCard);
    if (!alvo) {
        topico.anotacoes.forEach(a => {
            if (a.itensCorrelacionados) {
                const enc = a.itensCorrelacionados.find(ic => ic.uuid === uuidCard);
                if (enc) alvo = enc;
            }
        });
    }

    if (alvo && alvo.tipo === 'audio') {
        try {
            const d = JSON.parse(alvo.conteudo);
            if (d.transcricao) {
                navigator.clipboard.writeText(d.transcricao).then(() => {
                    exibirToast('Degravação copiada para a área de transferência!', 'sucesso');
                });
            } else {
                exibirToast('Este áudio não possui degravação.', 'aviso');
            }
        } catch(e) { exibirToast('Erro ao ler dados do áudio.', 'erro'); }
    }
};

// window.SubDnDManager removido na refatoração de limpeza
