/* ================================================
   ai_recommendation-service.js
   Serviço de Inteligência Artificial e LLM para o Acervo (Agravo de Instrumento)
   ================================================ */

window.AIRecommendationManager = (function () {
    'use strict';

    const GROQ_MODELS = [
        'openai/gpt-oss-20b',  // Prioridade 1: 1.000 t/s
        'qwen/qwen3.6-27b',    // Prioridade 2: 500 t/s (Ótimo fallback geral)
        'openai/gpt-oss-120b'  // Prioridade 3: 500 t/s (Raciocínio denso)
    ];

    function emitirErroAuth(provedor) {
        window.dispatchEvent(new CustomEvent('aiAuthError', { detail: { provider: provedor } }));
    }

    // --- ESTRATÉGIAS DE EXECUÇÃO DE REDE ---
    
    async function executarGroq(prompt, key) {
        for (let i = 0; i < GROQ_MODELS.length; i++) {
            const model = GROQ_MODELS[i];
            
            if (i > 0) await new Promise(r => setTimeout(r, 1500)); // Rate limit prevention
            
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 800 })
            });

            if (response.status === 401 || response.status === 403) {
                emitirErroAuth('groq');
                throw new Error("AUTH_ERROR"); 
            }
            if (response.ok) {
                const data = await response.json();
                return data.choices[0].message.content;
            }
        }
        throw new Error("RATE_LIMIT_ERROR"); 
    }

    async function executarGemini(prompt, key) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (response.status === 400) {
            let isAuthError = false;
            try {
                const errorData = await response.json();
                const errorMessage = errorData?.error?.message || '';
                if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API_KEY_EXPIRED') || errorMessage.includes('API key not valid')) {
                    isAuthError = true;
                }
            } catch (jsonErr) {
                console.warn("[Juris IA] Falha ao ler erro 400 do Gemini. Assumindo barreira de segurança.");
            }

            if (isAuthError) {
                emitirErroAuth('gemini');
                throw new Error("AUTH_ERROR");
            } else {
                throw new Error("PROMPT_BLOCKED_ERROR");
            }
        }

        if (response.ok) {
            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
        }
        throw new Error("RATE_LIMIT_ERROR");
    }

    // --- ORQUESTRADOR / DISPATCHER ---

    async function processarIA(promptCompleto) {
        if (!window.AIManager) throw new Error("AIManager não encontrado.");

        const config = window.AIManager.getConfig();
        const primary = config.provedor;
        const secondary = primary === 'groq' ? 'gemini' : 'groq';
        
        // Identifica as chaves baseadas na escolha
        const primaryKey = primary === 'groq' ? config.groqKey : config.geminiKey;
        const secondaryKey = secondary === 'groq' ? config.groqKey : config.geminiKey;

        // 1. BLOQUEIO IMEDIATO SE FALTAR A CHAVE PRINCIPAL
        if (!primaryKey) {
            window.AIManager.abrirModal();
            throw new Error(`A chave do seu provedor selecionado (${primary.toUpperCase()}) não está configurada. Cole a chave e clique em "Testar".`);
        }

        // 2. TENTA PROVEDOR PRINCIPAL
        try {
            if (primary === 'groq') return await executarGroq(promptCompleto, primaryKey);
            if (primary === 'gemini') return await executarGemini(promptCompleto, primaryKey);
        } catch (e) {
            // Se o erro for de validação da chave ou filtro de segurança, bloqueia aqui.
            if (e.message === "AUTH_ERROR") throw new Error(`A chave do provedor ${primary.toUpperCase()} é inválida ou expirou.`);
            if (e.message === "PROMPT_BLOCKED_ERROR") throw new Error("A IA recusou o texto (Filtro de Segurança). Reveja o conteúdo.");
            
            // 3. INICIA FALLBACK
            window.exibirToast?.(`Provedor ${primary.toUpperCase()} instável. A tentar usar o ${secondary.toUpperCase()}...`, 'aviso');
            
            // Verifica se tem a segunda chave configurada para fazer o fallback
            if (!secondaryKey) {
                throw new Error(`O serviço ${primary.toUpperCase()} falhou (erro de rede/sobrecarga), e não tem a chave do ${secondary.toUpperCase()} configurada para o sistema se auto-recuperar.`);
            }

            try {
                // Executa a segunda opção
                if (secondary === 'groq') return await executarGroq(promptCompleto, secondaryKey);
                if (secondary === 'gemini') return await executarGemini(promptCompleto, secondaryKey);
            } catch (fallbackError) {
                if (fallbackError.message === "AUTH_ERROR") throw new Error(`A chave do provedor alternativo (${secondary.toUpperCase()}) é inválida.`);
                if (fallbackError.message === "PROMPT_BLOCKED_ERROR") throw new Error("A IA alternativa também bloqueou o texto por filtros de segurança.");
                throw new Error("Ambos os provedores de IA falharam por sobrecarga ou erro de rede.");
            }
        }
    }

    // --- LÓGICA DE NEGÓCIO DO AGRAVO ---

    async function buscarModelosCompativeis(topicoId, textoAlegacoes) {
        if (!textoAlegacoes || textoAlegacoes.trim() === '') return window.exibirToast?.('Redija os Fundamentos do Agravo primeiro.', 'aviso');
        
        if (typeof window.AcervoManager === 'undefined') {
            if (window.exibirToast) window.exibirToast('Módulo do Acervo não está carregado.', 'erro');
            return;
        }

        const modelos = await window.AcervoManager.carregarModelos();
        if (modelos.length === 0) return window.exibirToast?.('Seu acervo está vazio.', 'aviso');

        // PAYLOAD OTIMIZADO: Apenas ID e Título
        const catalogoComprimido = modelos.map(m => `ID: ${m.id} | Título: ${m.nome}`).join("\n");

        const btnIcon = document.querySelector('.preamble-alegacao .ai-trigger-btn');
        if (btnIcon) btnIcon.classList.add('is-thinking');
        window.exibirToast?.('A iniciar análise de IA...', 'info');

        const fullPrompt = `Atue como um analista jurídico especializado em Admissibilidade Recursal e Agravo de Instrumento. 
Analise a tese/fundamento e encontre os modelos compatíveis no acervo.
TESE / FUNDAMENTOS DO AGRAVO: "${textoAlegacoes}"

ACERVO:
${catalogoComprimido}

REGRA ESTABELECIDA:
Se houver modelos compatíveis, responda OBRIGATORIAMENTE no formato exato: [IDs: mod-xxx, mod-yyy]
Se NÃO houver NENHUM modelo compatível com o tema, responda OBRIGATORIAMENTE: [IDs: NENHUM]`;

        try {
            let respostaBruta = await processarIA(fullPrompt);

            // Sanitização de resposta (Clean Tags)
            respostaBruta = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
            if (respostaBruta.includes('</think>')) respostaBruta = respostaBruta.split('</think>').pop().trim();
            respostaBruta = respostaBruta.replace(/^```(?:markdown|text|json)?\r?\n?([\s\S]*?)\r?\n?```[\s\S]*$/i, '$1').trim();

            if (respostaBruta.includes("NENHUM")) {
                window.exibirToast?.('Nenhum modelo de alta afinidade encontrado para este Agravo.', 'aviso');
                return; 
            }

            const idsExtraidos = respostaBruta.match(/mod-[a-zA-Z0-9_-]+/g);

            if (!idsExtraidos || idsExtraidos.length === 0) {
                window.exibirToast?.('A IA não retornou IDs válidos. Tente reformular os fundamentos.', 'aviso');
                return;
            }

            if (typeof window.aplicarFiltroIAAcervo === 'function') {
                window.aplicarFiltroIAAcervo(idsExtraidos);
                window.exibirToast?.('Filtro de Inteligência Artificial aplicado ✨', 'sucesso');
            }

        } catch (error) {
            console.warn("[Juris IA Error]", error);
            window.exibirToast?.(error.message, 'erro');
        } finally {
            if (btnIcon) btnIcon.classList.remove('is-thinking');
        }
    }

    return {
        buscarModelosCompativeis
    };
})();