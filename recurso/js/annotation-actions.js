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
    
    const rotulos = { 
        'comando': 'Comando Direto', 
        'texto': 'Texto Fixo', 
        'nota': 'Nota Oculta', 
        'premissa': 'Premissa Padrão',
        'veredito': 'Veredito / Conclusão',
        'fundamentacao': 'Fundamentação Legal',
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

function abrirModalEdicao(contexto, textoAtual, comentarioAtual = '', tituloModal = null, placeholderText = null) {
    _editContext = contexto;
    _editContext.textoOriginal = textoAtual || '';
    _editContext.isDirty = false; // Flag crítica para o Guard

    const editor = document.getElementById('edit-text-input');
    const commentArea = document.getElementById('edit-comentario-input');
    const toolbar = document.getElementById('edit-toolbar');
    const title = document.getElementById('edit-modal-title');
    const backdrop = document.getElementById('text-edit-backdrop');
    const isAudio = contexto.tipoAnotacao === 'audio';

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
    document.getElementById('text-edit-modal').style.display = 'flex';

    setTimeout(() => {
        editor.focus();
        if (typeof editor.scrollTop === 'number') editor.scrollTop = 0;
    }, 50);
}

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
    backdrop.classList.remove('is-visible');
    document.getElementById('text-edit-modal').style.display = 'none';
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
    const textoAtual = topico[campo] || '';
    abrirModalEdicao({ tipo: 'preambulo', topicoId: topicoId, campo: campo }, textoAtual);
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
    if (topico.anotacoes.length <= 1) return exibirToast('Apenas uma anotação existente.', 'aviso');

    abrirModalReordenar('main', topicoId, index, topico.anotacoes.length);
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
    const posAtual = tipo === 'main' ? index + 1 : subIndex + 1;

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
        topico.anotacoes.splice(novaPos - 1, 0, item);
    } else if (_reordenarCtx.tipo === 'sub') {
        // Novo suporte arquitetural para nós de ideia
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

    if (isNaN(inputVal) || inputVal < 1 || inputVal > topico.anotacoes.length) return;

    const cardDestino = topico.anotacoes[inputVal - 1];
    
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
    
    if (isNaN(destinoTarget) || destinoTarget < 1 || destinoTarget > topico.anotacoes.length) {
        return exibirToast(`Destino inválido. Escolha um número entre 1 e ${topico.anotacoes.length}.`, 'erro');
    }
    
    const destinoIndex = destinoTarget - 1;
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

function _aplicarVisualBotaoTese(chave) {
    const btn = document.getElementById('btn-classificacao-tese');
    const iconSpan = document.getElementById('icone-classificacao-tese');
    const textSpan = document.getElementById('texto-classificacao-tese');
    
    if (!btn || !window.TopicsManager || !TopicsManager.MAPA_TESE_ICONES) {
        console.warn('[Tese] TopicsManager.MAPA_TESE_ICONES não disponível.');
        return;
    }
    
    const config = TopicsManager.MAPA_TESE_ICONES[chave] || TopicsManager.MAPA_TESE_ICONES['neutro'];
    
    // Atualiza estado
    btn.dataset.classificacao = chave;
    btn.title = config.title;
    
    // Atualiza visual via classes CSS (não inline styles)
    if (iconSpan) {
        iconSpan.className = `tese-icon-circle ${config.classeCss}`;
        iconSpan.innerHTML = `<svg><use href="${config.spriteId}"></use></svg>`;
    }
    
    // Atualiza label e cor do texto
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
    
    // Aplica o novo estado visual
    _aplicarVisualBotaoTese(novaClasse);
    
    // Microinteração: "Pulinho" visual para indicar o clique
    const iconSpan = document.getElementById('icone-classificacao-tese');
    if (iconSpan) {
        iconSpan.style.transform = 'scale(0.8)';
        setTimeout(() => {
            iconSpan.style.transform = 'scale(1)';
        }, 100);
    }
};

function abrirModalTese(topicoId, index) {
    _ideiaContextoTese = { topicoId, index };
    const topico = topicos.find(t => t.id === topicoId);
    if (!topico || !topico.anotacoes[index]) return;

    const anotacao = topico.anotacoes[index];
    
    document.getElementById('tese-ideia-num').textContent = index + 1;
    
    const textarea = document.getElementById('input-texto-tese');
    textarea.value = anotacao.tese || '';
    
    _aplicarVisualBotaoTese(anotacao.teseClassificacao || 'neutro');
    
    document.getElementById('wizard-backdrop').style.display = 'block';
    document.getElementById('modal-editar-tese').style.display = 'flex';
    
    // Auto-focus com preservação de scroll
    setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 50);
}

function fecharModalTese() {
    document.getElementById('wizard-backdrop').style.display = 'none';
    document.getElementById('modal-editar-tese').style.display = 'none';
    _ideiaContextoTese = null;
}

function salvarTese() {
    if (!_ideiaContextoTese) return;
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
    let destinoIdx = null;

    // 1. Validação Robusta para ambas as escolhas
    if (!isNova) {
        const destinoVal = parseInt(inputVal, 10);
        if (isNaN(destinoVal) || destinoVal < 1 || destinoVal > topico.anotacoes.length) {
            return exibirToast('Número de destino inválido.', 'erro');
        }
        destinoIdx = destinoVal - 1;
        if (_smartMoveCtx.correlacionadoIndex === null && destinoIdx === _smartMoveCtx.parentIndex) {
            return exibirToast('Não é possível mover a ideia para ela mesma.', 'erro');
        }
    } else {
        // Se escolheu Nova Ideia e digitou um número
        if (inputVal.trim() !== '') {
            const destinoVal = parseInt(inputVal, 10);
            if (isNaN(destinoVal) || destinoVal < 1 || destinoVal > topico.anotacoes.length + 1) {
                return exibirToast('Posição para a nova ideia é inválida.', 'erro');
            }
            destinoIdx = destinoVal - 1;
        }
    }

    // 2. Extração da Prova da sua Origem Original (Operação Isolada)
    let itemMovido;
    let arrayReduziu = false;

    if (_smartMoveCtx.correlacionadoIndex !== null) {
        // Cenário A: Movendo um filho (mantém comportamento original atômico via splice)
        itemMovido = topico.anotacoes[_smartMoveCtx.parentIndex].itensCorrelacionados.splice(_smartMoveCtx.correlacionadoIndex, 1)[0];
    } else {
        // Cenário B: Movendo o Card Principal
        const cardOriginal = topico.anotacoes[_smartMoveCtx.parentIndex];

        if (cardOriginal.itensCorrelacionados && cardOriginal.itensCorrelacionados.length > 0) {
            // FASE 1: CONSTRUÇÃO EM MEMÓRIA (Deep Clone para evitar mutação cruzada)
            const cloneProfundo = structuredClone(cardOriginal);
            
            // O "novo líder" será o primeiro item dos filhos clonados
            const novoMainCard = cloneProfundo.itensCorrelacionados.shift();
            
            // Transferindo a "coroa" (herança de estado) para o novo líder
            novoMainCard.tese = cloneProfundo.tese;
            novoMainCard.itensCorrelacionados = cloneProfundo.itensCorrelacionados;

            // Preparando o card que vai viajar.
            // Usamos defaults em vez de 'delete' para preservar a otimização da Hidden Class no V8
            itemMovido = structuredClone(cardOriginal);
            itemMovido.itensCorrelacionados = [];
            itemMovido.tese = ""; 

            // FASE 2: ESCRITA ATÔMICA (Commit no array oficial)
            topico.anotacoes[_smartMoveCtx.parentIndex] = novoMainCard;
            arrayReduziu = false; // A posição foi apenas substituída, o array não diminuiu
            
        } else {
            // Cenário C: Card Principal solteiro
            itemMovido = topico.anotacoes.splice(_smartMoveCtx.parentIndex, 1)[0];
            arrayReduziu = true;
        }
    }

    // Compensação matemática de índice de destino
    if (arrayReduziu && _smartMoveCtx.correlacionadoIndex === null) {
        if (!isNova && destinoIdx > _smartMoveCtx.parentIndex) destinoIdx--;
        if (isNova && destinoIdx !== null && destinoIdx > _smartMoveCtx.parentIndex) destinoIdx--; 
    }

    // 3. Inserção no Destino Final
    if (isNova) {
        if (!itemMovido.itensCorrelacionados) itemMovido.itensCorrelacionados = [];
        if (!itemMovido.subAnotacoes) itemMovido.subAnotacoes = [];
        
        if (destinoIdx !== null) {
            topico.anotacoes.splice(destinoIdx, 0, itemMovido); // Insere no meio
            exibirToast(`Prova transformada em Nova Ideia na posição ${destinoIdx + 1}.`, 'sucesso');
        } else {
            topico.anotacoes.push(itemMovido); // Joga pro final
            exibirToast('Prova transformada em Nova Ideia no final.', 'sucesso');
        }
    } else {
        const cardDestino = topico.anotacoes[destinoIdx];
        if (!cardDestino.itensCorrelacionados) cardDestino.itensCorrelacionados = [];
        cardDestino.itensCorrelacionados.push(itemMovido);
        exibirToast(`Prova agrupada à Ideia ${destinoIdx + 1}.`, 'sucesso');
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
        'fundamentacao': { titulo: 'Base Legal', texto: 'A IA priorizará esta lei/súmula acima de qualquer outra.' },
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
