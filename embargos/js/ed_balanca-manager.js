/* ================================================
   ed_balanca-manager.js
   Módulo de Integração Segura de Painéis HTML Externos (ED)
   ================================================ */
window.BalancaManager = (function() {
    'use strict';
    
    let htmlState = null;
    let pendingTasksCount = 0;

    // ATUALIZAÇÃO: Atalho Alt + B protegido e inteligente
    document.addEventListener('keydown', function(e) {
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable;
            
            if (!isTyping) {
                e.preventDefault();
                htmlState ? abrirPainel() : resetToGenerator();
            }
        }
    });

    // NOVO: Validação estrita de segurança (Zero Trust) e listener de mensagens
    window.addEventListener('message', function(event) {
        const iframe = document.getElementById('balanca-iframe');
        
        // 1. GATEKEEPER: Validação Estrita de Identidade (Zero Trust para Sandboxes)
        // Rejeita qualquer origem 'null' que não seja fisicamente a janela do nosso próprio iframe.
        if (event.origin === "null") {
            if (!iframe || event.source !== iframe.contentWindow) {
                console.warn("[Juris Notes Security] postMessage rejeitado. Origem 'null' não corresponde ao iframe esperado.");
                return;
            }
        } else {
            // Validação de domínios de rede externos
            const allowedOrigins = [window.location.origin, 'http://localhost', 'http://127.0.0.1'];
            if (!allowedOrigins.some(origin => event.origin.startsWith(origin))) {
                return;
            }
        }

        // 2. PROCESSAMENTO: Tratamento do Evento do Dossiê
        if (event.data && event.data.type === 'DOSSIE_GENERATED') {
            
            // Validação de integridade do payload
            if (!event.data.html || typeof event.data.html !== 'string') {
                console.error('[Juris Notes Error] Payload do Dossiê corrompido.');
                // Envia NACK (Feedback Negativo) para o iframe destravar o botão do usuário
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'DOSSIE_ERROR', message: 'Payload inválido.' }, '*');
                }
                return;
            }

            // Sucesso: Aplica a transição
            htmlState = event.data.html;
            iframe.removeAttribute('src'); 
            
            // NOVO: Adiciona um gatilho para rolar até a trilha assim que o novo HTML renderizar
            const triggerScroll = () => {
                aguardarDomERolarParaTrilha(iframe);
                iframe.removeEventListener('load', triggerScroll);
            };
            iframe.addEventListener('load', triggerScroll);
            
            // Esta mutação síncrona destrói o documento atual do iframe e renderiza o novo.
            // O feedback visual de sucesso para o usuário é a própria renderização do Dossiê.
            iframe.srcdoc = htmlState;     

            atualizarInterface();
            
            if (typeof window.salvarBackupAutomatico === 'function') {
                window.salvarBackupAutomatico();
            }
            if (typeof window.exibirToast === 'function') {
                window.exibirToast('Dossiê vinculado com sucesso!', 'sucesso');
            }
        }

        // 3. ATUALIZAÇÃO REVERSA: Disparada pelo botão Salvar do Dossiê ou Fechamento de Painel
        if (event.data && event.data.type === 'DOSSIE_UPDATED') {
            if (event.data.html && typeof event.data.html === 'string') {
                htmlState = event.data.html; // Atualiza em memória SEM recarregar o iframe (evita piscar a tela)
                
                if (typeof window.salvarBackupAutomatico === 'function') {
                    window.salvarBackupAutomatico(); // Salva no banco/storage principal
                }
                
                // Exibe feedback visual apenas se foi um salvamento manual (não-silencioso)
                if (!event.data.silent && typeof window.exibirToast === 'function') {
                    window.exibirToast('Alterações sincronizadas com o sistema principal!', 'sucesso');
                }
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
                // Removemos o IPC Delegado e voltamos a usar o controle direto (como no AI)
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
            // Reflow síncrono necessário antes de reatribuir o mesmo srcdoc
            void iframe.offsetWidth;
            iframe.srcdoc = htmlState;
        } else {
            iframe.removeAttribute('srcdoc');
            iframe.src = '../dossie/index.html'; // Puxa o gerador da raiz
        }
    }

    /**
     * Rastreador Blindado (Bulletproof Polling):
     * Ignora o readyState e caça fisicamente o elemento no DOM para garantir
     * que a rolagem só ocorra quando ele existir e o layout estiver desenhado.
     */
    function aguardarDomERolarParaTrilha(iframe, tentativas = 0) {
        const MAX_TENTATIVAS = 40; // ~2 segundos no total (40 x 50ms)
        const doc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);

        if (!doc) {
            if (tentativas < MAX_TENTATIVAS) setTimeout(() => aguardarDomERolarParaTrilha(iframe, tentativas + 1), 50);
            return;
        }

        // 1. Busca proativa pelo elemento alvo no DOM real
        let alvo = doc.getElementById('secao-trilha-julgamento');
        if (!alvo) {
            const candidatos = Array.from(doc.querySelectorAll('h1, h2, h3, h4, div.section-title, span.item-title'));
            alvo = candidatos.find(el => el.textContent.trim().toLowerCase().includes('trilha de julgamento'));
        }

        // 2. Se o elemento ainda não nasceu no DOM, continua caçando
        if (!alvo) {
            if (tentativas < MAX_TENTATIVAS) {
                setTimeout(() => aguardarDomERolarParaTrilha(iframe, tentativas + 1), 50);
            } else {
                console.warn('[Juris Notes ED] Trilha de Julgamento não encontrada a tempo.');
            }
            return;
        }

        // 3. Encontrou! Delay estratégico para garantir que o CSS (layout) terminou de pintar as alturas
        setTimeout(() => {
            try {
                alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
                alvo.classList.add('card-flash-focus');
                setTimeout(() => alvo.classList.remove('card-flash-focus'), 1300);
            } catch (e) {
                console.warn('[Juris Notes ED] Falha ao tentar rolar a página.', e);
            }
        }, 150);
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
    // DELEGAÇÃO DE TAREFAS NATIVAS
    // ==========================================
    function avaliarTarefasPendentes() {
        const badge = document.getElementById('badge-tarefas');
        if(badge && badge.style.display !== 'none') {
            return parseInt(badge.textContent.replace('+', '')) || 0;
        }
        return 0;
    }

    // ==========================================
    // ATUALIZAÇÃO VISUAL CENTRALIZADA
    // ==========================================
    function atualizarInterface() {
        const btnBalanca = document.getElementById('btn-balanca-justica');
        const btnLembrete = document.getElementById('btn-lembretes-tarefa');
        
        if (!btnBalanca || !btnLembrete) return;

        // Regra 1: O ícone da balança só fica carregado se houver HTML
        if (htmlState) {
            btnBalanca.classList.add('is-loaded');
        } else {
            btnBalanca.classList.remove('is-loaded');
        }
        
        // Regra 2: Botão Lembretes independe da Balança agora
        btnLembrete.disabled = false;
    }

    function fecharPainel() {
        sincronizarEstadoInterno(); 
        atualizarInterface(); // Atualiza a bolinha vermelha ao fechar o painel
        
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
            atualizarInterface(); // Atualiza UI ao carregar
            
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
            // Tenta o acesso direto clássico
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            
            doc.querySelectorAll('textarea').forEach(el => el.textContent = el.value);
            doc.querySelectorAll('input[type="text"], input[type="number"], input[type="hidden"]').forEach(el => el.setAttribute('value', el.value));
            
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
            // Plano B de Segurança: Acesso bloqueado. Solicita ao iframe que envie seus próprios dados.
            console.warn("[Juris Notes ED] Acesso direto ao DOM bloqueado por segurança. Solicitando push via postMessage...");
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'REQUEST_SYNC' }, '*');
            }
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
