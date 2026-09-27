/* ================================================
   ed_balanca-manager.js
   Módulo de Integração Segura de Painéis HTML Externos (ED)
   ================================================ */
window.BalancaManager = (function() {
    'use strict';
    
    let htmlState = null;
    let pendingTasksCount = 0;

    // GESTÃO DE MEMÓRIA: Guarda os timers das animações vinculados aos iframes
    const scrollTimersMap = new WeakMap();

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
        const irParaTrilha = !!htmlState; 

        if (htmlState) {
            let execucaoGarantida = false; // Trava contra dupla execução (Race Condition Lock)

            // Closure atômica: Quem chamar primeiro executa, os demais são abortados.
            const executarCargaUnica = () => {
                if (execucaoGarantida) return;
                execucaoGarantida = true;
                
                sincronizarContextoDossie(typeof topicos !== 'undefined' ? topicos : []);
                if (irParaTrilha) {
                    aguardarDomERolarParaTrilha(iframe);
                }
                
                iframe.removeEventListener('load', executarCargaUnica);
            };

            // 1. Armamos o gatilho principal (via evento natural do DOM)
            iframe.addEventListener('load', executarCargaUnica);

            // Força recarga do Iframe
            iframe.removeAttribute('srcdoc');
            iframe.removeAttribute('src');
            void iframe.offsetWidth; // Reflow síncrono
            iframe.srcdoc = htmlState;

            // 2. Armamos o gatilho de resgate (Fallback para BFCache/Otimizações do Chrome)
            // Se o navegador ignorar o load por ser o mesmo HTML, forçamos a execução.
            setTimeout(executarCargaUnica, 200);

        } else {
            iframe.removeAttribute('srcdoc');
            iframe.src = '../dossie/index.html'; 
        }
    }

    /**
     * Rola para a Trilha de Julgamento com busca segura, scroll instantâneo
     * e gestão de memória rigorosa (WeakMap + Cleanup).
     */
    function aguardarDomERolarParaTrilha(iframe, tentativas = 0) {
        const MAX_TENTATIVAS = 40;
        let doc = null;

        try {
            doc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);
        } catch (e) {
            doc = null;
        }

        if (!doc) {
            if (tentativas < MAX_TENTATIVAS) {
                setTimeout(() => aguardarDomERolarParaTrilha(iframe, tentativas + 1), 50);
            }
            return;
        }

        const alvo = localizarTrilhaVisivel(doc);

        if (!alvo) {
            if (tentativas < MAX_TENTATIVAS) {
                setTimeout(() => aguardarDomERolarParaTrilha(iframe, tentativas + 1), 50);
            } else {
                console.warn('[Juris Notes ED] Trilha de Julgamento visível não encontrada.');
            }
            return;
        }

        const rolar = () => {
            try {
                // 1. CLEANUP ISOLADO DE TIMERS ANTIGOS
                const currentTimers = scrollTimersMap.get(iframe) || [];
                currentTimers.forEach(clearTimeout);
                
                // 2. CSS SINGLETON INJECTION (Ancoragem e Animação)
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                const styleId = 'juris-highlight-fx';
                if (!doc.getElementById(styleId)) {
                    const styleTag = doc.createElement('style');
                    styleTag.id = styleId;
                    styleTag.textContent = `
                        /* Ancoragem de rolagem nativa para respeitar o cabeçalho fixo */
                        .juris-scroll-anchor {
                            scroll-margin-top: 90px;
                        }
                        /* Feedback visual que não quebra o Box Model */
                        .juris-focus-pulse {
                            animation: juris-pulse-anim 1.2s ease-out forwards;
                            border-radius: 4px;
                        }
                        @keyframes juris-pulse-anim {
                            0% { background-color: transparent; box-shadow: 0 0 0 0 transparent; }
                            15% { background-color: #e0f2fe; box-shadow: 0 0 0 6px #e0f2fe; }
                            100% { background-color: transparent; box-shadow: 0 0 0 0 transparent; }
                        }
                    `;
                    doc.head.appendChild(styleTag);
                }

                // 3. APLICAÇÃO DE CLASSES E ROLAGEM NATIVA
                alvo.classList.remove('juris-focus-pulse');
                alvo.classList.add('juris-scroll-anchor'); // Prepara o terreno para o scroll nativo
                
                void alvo.offsetWidth; // Força Reflow para reiniciar CSS Animations
                
                // A API nativa sobe a árvore DOM e rola o contêiner correto (resolvendo a falha silenciosa)
                alvo.scrollIntoView({ behavior: 'instant', block: 'start' });
                alvo.classList.add('juris-focus-pulse'); // Acende o feedback visual

                // Fallbacks estruturais para extrema retrocompatibilidade em iframes isolados
                const fallbackDestino = Math.max(0, alvo.getBoundingClientRect().top + (iframe.contentWindow.pageYOffset || 0) - 90);
                if (doc.documentElement.scrollTop === 0) doc.documentElement.scrollTop = fallbackDestino;
                if (doc.body && doc.body.scrollTop === 0) doc.body.scrollTop = fallbackDestino;

                // 4. REGISTRO DE TIMERS SEGURO (Cleanup após a animação)
                const cleanupTimer = setTimeout(() => {
                    if (alvo && alvo.isConnected) {
                        alvo.classList.remove('juris-focus-pulse');
                        // Mantém a âncora, remove apenas o efeito de pulso
                    }
                }, 1300);

                scrollTimersMap.set(iframe, [cleanupTimer]);

            } catch (e) {
                console.warn('[Juris Notes ED] Falha ao tentar rolar até a Trilha.', e);
            }
        };

        // Duplo requestAnimationFrame estabiliza o cálculo em iframes complexos
        if (iframe.contentWindow && typeof iframe.contentWindow.requestAnimationFrame === 'function') {
            iframe.contentWindow.requestAnimationFrame(() => {
                iframe.contentWindow.requestAnimationFrame(() => {
                    setTimeout(rolar, 80);
                });
            });
        } else {
            setTimeout(rolar, 150);
        }
    }

    // ==========================================
    // FUNÇÕES AUXILIARES DE BUSCA SEGURA
    // ==========================================
    function normalizarTextoED(texto) {
        let t = texto || '';

        if (typeof t.normalize === 'function') {
            t = t.normalize('NFKD');
        }

        return t
            .toLowerCase()
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function elementoVisivelED(doc, el) {
        try {
            if (!el) return false;

            if (!el.isConnected && !(doc.contains && doc.contains(el))) {
                return false;
            }

            const win = doc.defaultView;

            if (!win) return true;

            const style = win.getComputedStyle(el);

            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }

            let node = el.parentElement;

            while (node && node !== doc.documentElement) {
                const nodeStyle = win.getComputedStyle(node);

                if (nodeStyle.display === 'none' || nodeStyle.visibility === 'hidden') {
                    return false;
                }

                // Se estiver dentro de sanfona fechada, considera invisível
                if (node.classList && node.classList.contains('sync-accordion-body')) {
                    const wrapper = node.closest('.sync-accordion-wrapper');

                    if (wrapper && !wrapper.classList.contains('is-open')) {
                        return false;
                    }
                }

                node = node.parentElement;
            }

            return el.getBoundingClientRect().height > 0;
        } catch (e) {
            return false;
        }
    }

    function localizarTrilhaVisivel(doc) {
        try {
            // 1) ID fixo — cenário ideal
            const alvoPorId = doc.getElementById('secao-trilha-julgamento');

            if (alvoPorId && elementoVisivelED(doc, alvoPorId)) {
                return alvoPorId;
            }

            // 2) Busca apenas por títulos visíveis
            const candidatos = Array.from(
                doc.querySelectorAll('h1, h2, h3, h4, div.section-title')
            ).filter(el => elementoVisivelED(doc, el));

            // 3) Prioriza explicitamente a seção 4
            const secao4 = candidatos.find(el =>
                normalizarTextoED(el.textContent).includes('4. trilha de julgamento')
            );

            if (secao4) return secao4;

            // 4) Prioriza o título completo da Trilha
            const tituloCompleto = candidatos.find(el => {
                const texto = normalizarTextoED(el.textContent);

                return texto.includes('trilha de julgamento') &&
                       texto.includes('arraste para reordenar');
            });

            if (tituloCompleto) return tituloCompleto;

            // 5) Qualquer título visível da Trilha
            const tituloTrilha = candidatos.find(el =>
                normalizarTextoED(el.textContent).includes('trilha de julgamento')
            );

            if (tituloTrilha) return tituloTrilha;

            // 6) Fallback para a lista de tópicos
            const lista = doc.getElementById('sortable-list');

            if (lista && elementoVisivelED(doc, lista)) {
                return lista;
            }

            return null;
        } catch (e) {
            return null;
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