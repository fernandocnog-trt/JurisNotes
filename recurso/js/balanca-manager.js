/* ================================================
   balanca-manager.js
   Módulo de Integração Segura de Painéis HTML Externos
   ================================================ */
window.BalancaManager = (function() {
    'use strict';
    
    let htmlState = null;
    let pendingTasksCount = 0;

    // Active Element Guard: Atalho Alt + B (Balança) protegido
    document.addEventListener('keydown', function(e) {
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable;
            
            if (!isTyping) {
                e.preventDefault();
                // Se já tem HTML, apenas abre. Se não, abre o gerador.
                htmlState ? abrirPainel() : resetToGenerator();
            }
        }
    });

    // NOVO: Validação estrita de segurança e listener de mensagens
    window.addEventListener('message', function(event) {
        // Aceita a própria origem (Produção) ou localhost (Dev)
        const allowedOrigins = [window.location.origin, 'http://localhost', 'http://127.0.0.1'];
        if (!allowedOrigins.some(origin => event.origin.startsWith(origin))) return;

        if (event.data && event.data.type === 'DOSSIE_GENERATED') {
            htmlState = event.data.html;
            
            const iframe = document.getElementById('balanca-iframe');
            iframe.removeAttribute('src'); // Limpa URL do gerador
            iframe.srcdoc = htmlState;     // Injeta Dossiê renderizado

            atualizarInterface();
            
            if (typeof window.salvarBackupAutomatico === 'function') {
                window.salvarBackupAutomatico();
            }
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Dossiê vinculado com sucesso!', 'sucesso');
            }
        }
    });

    function abrirPainel() {
        document.getElementById('balanca-modal-backdrop').style.display = 'block';
        document.getElementById('balanca-painel').style.display = 'flex';

        const iframe = document.getElementById('balanca-iframe');
        const irParaTrilha = !!htmlState; // só tenta scroll se já existir dossiê carregado

        // Listener seguro que se auto-destrói para evitar memory leak
        const onIframeLoad = () => {
            sincronizarContextoDossie(typeof topicos !== 'undefined' ? topicos : []);

            if (irParaTrilha) {
                aguardarDomERolarParaTrilha(iframe);
            }

            iframe.removeEventListener('load', onIframeLoad);
        };
        iframe.addEventListener('load', onIframeLoad);

        if (htmlState) {
            // Força o navegador a tratar como nova navegação, garantindo que
            // o evento 'load' dispare mesmo se o conteúdo for idêntico ao anterior.
            iframe.removeAttribute('srcdoc');
            iframe.removeAttribute('src');
            void iframe.offsetWidth; // reflow síncrono necessário antes de reatribuir o mesmo srcdoc
            iframe.srcdoc = htmlState;
        } else {
            iframe.removeAttribute('srcdoc');
            iframe.src = '../dossie/index.html'; // Caminho realocado do gerador
        }
    }

    /**
     * Aguarda o DOM interno do iframe estar pronto (sem número mágico de tempo)
     * e então executa a busca + scroll até a Trilha de Julgamento.
     */
    function aguardarDomERolarParaTrilha(iframe, tentativas = 0) {
        const MAX_TENTATIVAS = 20; // ~1s no total (20 x 50ms)
        const doc = iframe.contentDocument;

        if (!doc || doc.readyState !== 'complete') {
            if (tentativas < MAX_TENTATIVAS) {
                setTimeout(() => aguardarDomERolarParaTrilha(iframe, tentativas + 1), 50);
            }
            return;
        }

        rolarParaTrilhaDeJulgamento(doc);
    }

    function rolarParaTrilhaDeJulgamento(doc) {
        try {
            // ESTRATÉGIA 1 (preferencial e confirmada no gerador atual):
            // id="secao-trilha-julgamento" já existe em index.html do Dossiê.
            let alvo = doc.getElementById('secao-trilha-julgamento');

            // ESTRATÉGIA 2 (fallback de compatibilidade retroativa):
            // cobre dossiês antigos salvos sem o id, e também variações de
            // numeração/rótulo (ex.: "4. Trilha de Julgamento (Arraste para Reordenar)").
            if (!alvo) {
                const candidatos = Array.from(doc.querySelectorAll('h1, h2, h3, h4, div.section-title'));
                alvo = candidatos.find(el =>
                    el.textContent.trim().toLowerCase().includes('trilha de julgamento')
                );
            }

            if (alvo) {
                alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Reaproveita a animação já existente no projeto (juris-reader-tools.css)
                alvo.classList.add('card-flash-focus');
                setTimeout(() => alvo.classList.remove('card-flash-focus'), 1300);
            }
        } catch (e) {
            console.warn('[Juris Notes] Não foi possível localizar a Trilha de Julgamento no dossiê.', e);
        }
    }

    // (abrirLembretes removido - transferido para TaskManager nativo)

    function sincronizarContextoDossie(topicosInjetados) {
        const iframe = document.getElementById('balanca-iframe');
        if (iframe && iframe.contentWindow) {
            // Resolve o "Scoping Trap": Usa o array injetado. Se não houver, tenta o escopo local com segurança.
            const arrayReferencia = topicosInjetados || (typeof topicos !== 'undefined' ? topicos : []);
            
            // Mapeamento limpo dos tópicos atuais da matriz
            const topicosAtivos = arrayReferencia.map(t => ({
                id: t.id,
                nome: t.nome,
                cor: t.cor
            }));
            iframe.contentWindow.postMessage({ type: 'SYNC_TOPICS', topicos: topicosAtivos }, '*');
        }
    }

    // NOVO: Função protegida contra perda de dados
    function resetToGenerator() {
        if (htmlState !== null) {
            const confirmacao = confirm("⚠️ Atenção:\n\nIsso substituirá o Dossiê atual. Se você fez marcações de checkbox que não foram salvas no backup principal, elas serão perdidas.\n\nDeseja gerar um novo dossiê?");
            if (!confirmacao) return;
        }
        
        htmlState = null;
        pendingTasksCount = 0;
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) {
            iframe.removeAttribute('srcdoc');
            iframe.src = '../dossie/index.html';
        }
        abrirPainel();
        atualizarInterface();
    }

    // ==========================================
    // NOVO: DELEGAÇÃO DE TAREFAS
    // ==========================================
    function avaliarTarefasPendentes() {
        // Redireciona para o TaskManager nativo
        const badge = document.getElementById('badge-tarefas');
        if(badge && badge.style.display !== 'none') {
            return parseInt(badge.textContent.replace('+', '')) || 0;
        }
        return 0;
    }

    // ==========================================
    // NOVO: ATUALIZAÇÃO VISUAL CENTRALIZADA
    // ==========================================
    function atualizarInterface() {
        const btnBalanca = document.getElementById('btn-balanca-justica');
        const btnLembrete = document.getElementById('btn-lembretes-tarefa');
        
        if (!btnBalanca || !btnLembrete) return;

        // Regra 1: O ícone da balança só fica amarelo se houver HTML carregado
        if (htmlState) {
            btnBalanca.classList.add('is-loaded');
        } else {
            btnBalanca.classList.remove('is-loaded');
        }
        
        // Regra 2: O Lembrete agora é nativo e independe da balança
        btnLembrete.disabled = false;
    }

    function fecharPainel() {
        sincronizarEstadoInterno(); 
        atualizarInterface(); // <--- ATUALIZA A BOLINHA VERMELHA AO FECHAR O PAINEL
        
        document.getElementById('balanca-modal-backdrop').style.display = 'none';
        document.getElementById('balanca-painel').style.display = 'none';
        
        if (typeof window.salvarBackupAutomatico === 'function') {
            window.salvarBackupAutomatico();
        }
    }

    function processarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            htmlState = e.target.result;
            renderizarIframe(htmlState);
            atualizarInterface(); // <--- ATUALIZA UI AO CARREGAR
            
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Painel HTML importado e ancorado com sucesso!', 'sucesso');
            }
            abrirPainel(); 
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    function renderizarIframe(conteudoHTML) {
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) iframe.srcdoc = conteudoHTML;
    }

    function sincronizarEstadoInterno() {
        const iframe = document.getElementById('balanca-iframe');
        if (!iframe || !htmlState) return;

        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            
            doc.querySelectorAll('textarea').forEach(el => el.textContent = el.value);
            doc.querySelectorAll('input[type="text"], input[type="number"], input[type="hidden"]').forEach(el => el.setAttribute('value', el.value));
            
            // Tratamento Crítico de Checkboxes (Onde ficam as tarefas)
            doc.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
                if (el.checked) el.setAttribute('checked', 'checked');
                else el.removeAttribute('checked');
            });

            doc.querySelectorAll('select').forEach(select => {
                Array.from(select.options).forEach(opt => {
                    if (opt.selected) opt.setAttribute('selected', 'selected');
                    else opt.removeAttribute('selected');
                });
            });

            htmlState = doc.documentElement.outerHTML;

        } catch (e) {
            console.error("[Juris Notes] Sincronização do painel falhou.", e);
        }
    }

    function getHtmlState() {
        return htmlState;
    }

    function restoreHtmlState(htmlData) {
        htmlState = htmlData || null;
        if (htmlState) {
            renderizarIframe(htmlState);
        }
        // Timeout breve para dar tempo do Iframe renderizar antes de contar as tarefas no restore
        setTimeout(atualizarInterface, 100); 
    }

    function resetarEstado() {
        htmlState = null;
        pendingTasksCount = 0;
        const iframe = document.getElementById('balanca-iframe');
        if (iframe) iframe.srcdoc = '';
        atualizarInterface();
    }

    return { 
        abrirPainel, 
        fecharPainel, 
        processarUpload, 
        getHtmlState, 
        restoreHtmlState,
        resetarEstado,
        resetToGenerator,
        getPendingTasks: avaliarTarefasPendentes,
        sincronizarTopicos: sincronizarContextoDossie 
    };
})();
