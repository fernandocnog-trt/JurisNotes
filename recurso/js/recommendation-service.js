/* ================================================
   ai-recommendation-service.js
   Módulo de Integração IA (Multi-Provider & Fallback)
   ================================================ */
window.AIRecommendationManager = (function() {
    'use strict';

    const GROQ_MODELS = [
        'openai/gpt-oss-20b', 
        'qwen/qwen3.6-27b',   
        'openai/gpt-oss-120b' 
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
                body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], temperature: 0.1 })
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

    // --- ORQUESTRADOR / DISPATCHER CORRIGIDO ---

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
            
            // 3. INICIA FALLBACK (Apenas se for erro de rede/queda do servidor 503 ou 429)
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

    // --- LÓGICA DE NEGÓCIO ---

    async function buscarModelosCompativeis(topicoId, textoAlegacoes) {
        if (!textoAlegacoes || textoAlegacoes.trim() === '') return window.exibirToast?.('Redija as Razões Recursais primeiro.', 'aviso');
        
        const modelos = await window.AcervoManager.carregarModelos();
        if (modelos.length === 0) return window.exibirToast?.('Seu acervo está vazio.', 'aviso');

        const catalogoComprimido = modelos.map(m => `ID: ${m.id} | Título: ${m.nome}`).join("\n");

        const btnIcon = document.querySelector('.preamble-alegacao .ai-trigger-btn');
        if (btnIcon) btnIcon.classList.add('is-thinking');
        window.exibirToast?.('A iniciar análise de IA...', 'info');

        const fullPrompt = `Atue como um indexador jurídico especialista e rigoroso. 
Sua única função é analisar a tese e encontrar os modelos compatíveis no acervo fornecido. 
REGRA ESTABELECIDA:
- Se houver modelos compatíveis, responda OBRIGATORIAMENTE no formato exato: [IDs: mod-xxx, mod-yyy]
- Se NÃO houver NENHUM modelo compatível com o tema, responda OBRIGATORIAMENTE: [IDs: NENHUM]
- Não adicione explicações, saudações, markdown ou qualquer outro texto fora do formato exigido.

TESE: "${textoAlegacoes}"

ACERVO:
${catalogoComprimido}`;

        try {
            let respostaBruta = await processarIA(fullPrompt);

            // Sanitização de resposta (Clean Tags)
            respostaBruta = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
            if (respostaBruta.includes('</think>')) respostaBruta = respostaBruta.split('</think>').pop().trim();
            respostaBruta = respostaBruta.replace(/^```(?:markdown|text|json)?\r?\n?([\s\S]*?)\r?\n?```[\s\S]*$/i, '$1').trim();

            if (respostaBruta.includes("NENHUM")) {
                window.exibirToast?.('Nenhum modelo de alta afinidade encontrado.', 'aviso');
                return; 
            }

            const idsExtraidos = respostaBruta.match(/mod-[a-zA-Z0-9_-]+/g);

            if (!idsExtraidos || idsExtraidos.length === 0) {
                window.exibirToast?.('A IA não retornou IDs válidos. Tente reformular a tese.', 'aviso');
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

    function _extrairJsonAutoTeseSeguro(respostaBruta) {
        if (!respostaBruta || typeof respostaBruta !== 'string') {
            throw new Error('A IA retornou uma resposta vazia.');
        }

        // 1. Remove blocos <think> de modelos de raciocínio (Qwen / DeepSeek)
        let limpo = respostaBruta.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();
        if (limpo.includes('</think>')) {
            limpo = limpo.split('</think>').pop().trim();
        }

        // 2. Remove code fences markdown mesmo que haja texto conversacional antes ou depois
        limpo = limpo.replace(/```(?:json|markdown|text)?/gi, '').replace(/```/g, '').trim();

        // 3. Localiza o primeiro bloco balanceado { ... } para evitar captura gulosa (greedy)
        const firstBrace = limpo.indexOf('{');
        if (firstBrace !== -1) {
            let depth = 0;
            let inString = false;
            let escape = false;
            for (let i = firstBrace; i < limpo.length; i++) {
                const ch = limpo[i];
                if (escape) { escape = false; continue; }
                if (ch === '\\') { escape = true; continue; }
                if (ch === '"') { inString = !inString; continue; }
                if (!inString) {
                    if (ch === '{') depth++;
                    else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                            const candidato = limpo.substring(firstBrace, i + 1);
                            try {
                                return JSON.parse(candidato);
                            } catch (e) {
                                break; // Cai para o fallback de regex abaixo
                            }
                        }
                    }
                }
            }
        }

        // 4. Fallback de Contingência: Extrai campos via Regex se o JSON tiver aspas internas mal escapadas
        const matchTese = limpo.match(/"tese"\s*:\s*"([^"]+)"/i);
        const matchClass = limpo.match(/"classificacao"\s*:\s*"(autora|re|juizo|neutro)"/i);
        if (matchTese) {
            return {
                tese: matchTese[1],
                classificacao: matchClass ? matchClass[1].toLowerCase() : 'neutro'
            };
        }

        throw new Error('Não foi possível interpretar a sugestão da IA. Tente novamente.');
    }

    async function gerarAutoTese(contextoCardTexto) {
        if (!contextoCardTexto || contextoCardTexto.trim() === '') {
            throw new Error('O bloco não possui conteúdo textual suficiente para análise.');
        }

        const fullPrompt = `Atue como um Assessor de Desembargador Trabalhista sênior.
Sua tarefa é ler os elementos probatórios e anotações delimitados na tag <bloco_probatorio> e sintetizar a Tese Jurídica correspondente.

REGRAS DE ELABORAÇÃO:
1. "tese": Elabore um título ou resumo técnico, formal e direto (máximo de 180 caracteres) que identifique o tema e o cerne do argumento ou prova (Ex: "Horas extras. Invalidade dos controles de ponto britânicos. Prova oral dividida" ou "Nulidade processual. Cerceamento de defesa pelo indeferimento de contradita"). Não inclua nomes próprios de pessoas ou empresas.
2. "classificacao": Identifique a autoria/origem predominante da tese escolhendo ESTRITAMENTE uma das 4 opções:
   - "autora" (insurgência, pedido ou argumento da Parte Autora / Reclamante / Exequente)
   - "re" (defesa, contestação ou recurso da Parte Ré / Reclamada / Executada)
   - "juizo" (fundamento decisório estrito da Sentença / Acórdão / Magistrado)
   - "neutro" (fato objetivo, perícia ou registro sem polarização recursal definida)

<bloco_probatorio>
${contextoCardTexto}
</bloco_probatorio>

FORMATO DE RESPOSTA OBRIGATÓRIO:
Responda EXCLUSIVAMENTE com um objeto JSON válido em uma única linha, sem markdown e sem comentários:
{"tese": "Texto formal da tese", "classificacao": "autora"}`;

        const respostaBruta = await processarIA(fullPrompt);
        const dados = _extrairJsonAutoTeseSeguro(respostaBruta);

        const classesValidas = ['autora', 're', 'juizo', 'neutro'];
        const classificacaoSegura = classesValidas.includes(String(dados.classificacao || '').toLowerCase().trim())
            ? String(dados.classificacao).toLowerCase().trim()
            : 'neutro';

        const teseLimpa = String(dados.tese || '').replace(/\s+/g, ' ').trim();
        if (!teseLimpa) {
            throw new Error('A IA não retornou um texto de tese válido.');
        }

        return {
            tese: teseLimpa,
            classificacao: classificacaoSegura
        };
    }

    return { buscarModelosCompativeis, gerarAutoTese };
})();