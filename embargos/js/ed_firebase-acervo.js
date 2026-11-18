import { app, auth } from './ed_firebase-auth.js'; 
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, arrayUnion, query, orderBy, getDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const db = getFirestore(app);

window.AcervoManager = (function() {
    let modelosEmCache = [];

    function getUserId() {
        return auth.currentUser ? auth.currentUser.uid : null;
    }

    // HELPER 1: Geração de ID seguro e resiliente (Fallback para HTTP local)
    function _gerarIdSeguro(prefixo = 'mod-') {
        try {
            return prefixo + crypto.randomUUID();
        } catch (e) {
            console.warn("[AcervoManager] API Web Crypto indisponível. Usando fallback matemático.");
            return prefixo + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
        }
    }

    // HELPER 2: Dicionário de Erros Isolado (Evita string matching na UI)
    function _processarErroFirebase(erro, contexto) {
        console.error(`[AcervoManager] Falha em: ${contexto}`, erro);
        
        let msgUsuario = "Ocorreu um erro desconhecido ao comunicar com a nuvem.";
        
        // Mapeamento estrito baseado em código imutável do Firebase
        switch (erro.code) {
            case 'permission-denied':
                msgUsuario = "Acesso negado. Verifique as regras de segurança do banco de dados.";
                break;
            case 'not-found':
                msgUsuario = "Um ou mais modelos não foram encontrados na nuvem (podem ter sido excluídos em outra aba).";
                break;
            case 'unavailable':
            case 'network-request-failed':
                msgUsuario = "Sem conexão com a internet. Verifique sua rede e tente novamente.";
                break;
            case 'unauthenticated':
                msgUsuario = "Sua sessão expirou. Por favor, atualize a página e faça login novamente.";
                break;
        }

        // Lança um erro customizado que o app.js consiga ler de forma padronizada
        const erroTratado = new Error(msgUsuario);
        erroTratado.isCustom = true;
        throw erroTratado;
    }

    // HELPER NOVO: Lê a identidade do HTML para saber onde estamos rodando.
    // Retorna 'ro' como proteção caso a meta tag seja esquecida.
    function _getModuloAtual() {
        const metaTag = document.querySelector('meta[name="juris-module"]');
        return metaTag ? metaTag.content : 'ro';
    }

    async function salvarNovoModelo(nome, noOriginal) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado. Faça login.");

        const modeloId = _gerarIdSeguro();
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        
        const noLimpo = { intencao: noOriginal.intencao || 'premissa', texto: noOriginal.texto || '', timestamp: Date.now() };
        const moduloContexto = _getModuloAtual();

        try {
            await setDoc(docRef, { 
                nome: nome, 
                criadoEm: Date.now(), 
                nos: [noLimpo],
                modulo: moduloContexto,
                escopo: noOriginal.escopoOriginal || 'card' 
            });
            modelosEmCache = []; 
            return modeloId;
        } catch (e) {
            _processarErroFirebase(e, 'salvarNovoModelo (setDoc)');
        }
    }

    async function adicionarNoAModelo(modeloId, noOriginal) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado. Faça login.");

        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        const noLimpo = { intencao: noOriginal.intencao || 'premissa', texto: noOriginal.texto || '', timestamp: Date.now() };

        try {
            await updateDoc(docRef, { nos: arrayUnion(noLimpo), atualizadoEm: Date.now() });
            modelosEmCache = []; 
        } catch (e) {
             _processarErroFirebase(e, 'adicionarNoAModelo (updateDoc)');
        }
    }

    // HELPER: Verifica se a assinatura de auditoria continua íntegra (auto-invalidação por nome ou nº de nós)
    function verificarSeModeloAuditado(mod) {
        if (!mod || !mod.auditoriaIA || typeof mod.auditoriaIA !== 'object') return false;
        const qtdNosAtual = Array.isArray(mod.nos) ? mod.nos.length : 0;
        return (
            mod.auditoriaIA.nome === mod.nome &&
            mod.auditoriaIA.qtdNos === qtdNosAtual
        );
    }

    function criarAssinaturaAuditoria(nome, qtdNos, loteId = 'manual') {
        return {
            nome: String(nome || '').trim(),
            qtdNos: Number(qtdNos) || 0,
            em: Date.now(),
            loteId: loteId || 'manual'
        };
    }

    async function carregarModelos(forcarAtualizacao = false) {
        const uid = getUserId();
        if (!uid) return [];
        if (!forcarAtualizacao && modelosEmCache.length > 0) return modelosEmCache;

        const q = query(collection(db, "usuarios", uid, "acervo"), orderBy("nome", "asc"));
        const querySnapshot = await getDocs(q);
        
        const modelos = [];
        const moduloContexto = _getModuloAtual();

        querySnapshot.forEach((docSnap) => {
            // TRAVA DE SEGURANÇA: Ignora qualquer documento de configuração (--CONFIG-TAGS--, --CONFIG-LOTE-IA-*, etc.)
            if (docSnap.id.startsWith("--CONFIG-")) return;
            
            const dadosModelo = docSnap.data();
            const moduloDoModelo = dadosModelo.modulo || 'ro'; 

            if (moduloDoModelo === moduloContexto) {
                modelos.push({ id: docSnap.id, ...dadosModelo });
            }
        });
        
        modelosEmCache = modelos;
        return modelos;
    }

    // Funções Seguras de Escrita Direta (Bypassing Cache)
    async function atualizarNoDoModelo(modeloId, nodeIndex, dadosAtualizados) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        
        // 1. Fetch da fonte de verdade em tempo real
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("Modelo não encontrado na nuvem.");
        
        const dadosModelo = docSnap.data();
        if (!dadosModelo.nos || !dadosModelo.nos[nodeIndex]) return;

        // 2. Mutação Segura
        dadosModelo.nos[nodeIndex] = { ...dadosModelo.nos[nodeIndex], ...dadosAtualizados };
        
        // 3. Update e Invalidação de Cache
        await updateDoc(docRef, { nos: dadosModelo.nos, atualizadoEm: Date.now() });
        modelosEmCache = []; 
    }

    async function removerNoDoModelo(modeloId, nodeIndex) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        
        // 1. Fetch da fonte de verdade
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("Modelo não encontrado na nuvem.");
        
        const dadosModelo = docSnap.data();
        if (!dadosModelo.nos) return;

        // 2. Remoção do nó alvo
        dadosModelo.nos.splice(nodeIndex, 1); 
        
        // 3. Update e Invalidação de Cache
        await updateDoc(docRef, { nos: dadosModelo.nos, atualizadoEm: Date.now() });
        modelosEmCache = []; 
    }

    async function renomearModelo(modeloId, novoNome) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        await updateDoc(docRef, { nome: novoNome, atualizadoEm: Date.now() });
        modelosEmCache = []; // Invalidação agressiva de cache
    }

    async function excluirModeloCompleto(modeloId) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        await deleteDoc(docRef);
        modelosEmCache = []; // Invalidação agressiva de cache
    }

    async function salvarConfigTags(tagsArray) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        // MUDANÇA: Agora salva dentro da coleção 'acervo' para herdar suas permissões
        const docRef = doc(db, "usuarios", uid, "acervo", "--CONFIG-TAGS--");
        await setDoc(docRef, { lista: tagsArray, atualizadoEm: Date.now() });
    }

    async function carregarConfigTags() {
        const uid = getUserId();
        if (!uid) return [];
        
        // MUDANÇA: Lê do novo caminho autorizado
        const docRef = doc(db, "usuarios", uid, "acervo", "--CONFIG-TAGS--");
        const docSnap = await getDoc(docRef);
        return docSnap.exists() && docSnap.data().lista ? docSnap.data().lista : [];
    }

    async function atualizarTagEmTodosModelos(tagAntiga, tagNova) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const modelos = await carregarModelos();
        const batch = writeBatch(db); // Transação Atômica Segura
        let operacoes = 0;

        modelos.forEach(mod => {
            if (mod.tags && mod.tags.includes(tagAntiga)) {
                let novasTags = mod.tags;
                if (tagNova === null) {
                    novasTags = mod.tags.filter(t => t !== tagAntiga); // Exclusão
                } else {
                    novasTags = mod.tags.map(t => t === tagAntiga ? tagNova : t); // Renomeação
                }
                const docRef = doc(db, "usuarios", uid, "acervo", mod.id);
                batch.update(docRef, { tags: novasTags });
                operacoes++;
            }
        });

        if (operacoes > 0) {
            await batch.commit();
            modelosEmCache = []; // Limpa cache
        }
    }

    async function atualizarTagsDoModelo(modeloId, tagsMarcadas) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        await updateDoc(docRef, { tags: tagsMarcadas, atualizadoEm: Date.now() });
        modelosEmCache = [];
    }

    async function atualizarEscopoDoModelo(modeloId, novoEscopo) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        await updateDoc(docRef, { escopo: novoEscopo, atualizadoEm: Date.now() });
        modelosEmCache = [];
    }

    async function definirStatusAuditoriaModelo(modeloId, marcarComoAuditado) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");

        const docRef = doc(db, "usuarios", uid, "acervo", modeloId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("Modelo não encontrado na nuvem.");

        const dados = docSnap.data();
        const qtdNos = Array.isArray(dados.nos) ? dados.nos.length : 0;
        const novaAssinatura = marcarComoAuditado
            ? criarAssinaturaAuditoria(dados.nome, qtdNos, 'manual')
            : null;

        await updateDoc(docRef, {
            auditoriaIA: novaAssinatura,
            atualizadoEm: Date.now()
        });
        modelosEmCache = [];
        return novaAssinatura;
    }

    async function salvarManifestoLoteIA(loteInfo) {
        const uid = getUserId();
        if (!uid || !loteInfo || !loteInfo.loteId) return;

        const modulo = _getModuloAtual();
        const docId = `--CONFIG-LOTE-IA-${modulo}--`;
        const docRef = doc(db, "usuarios", uid, "acervo", docId);

        try {
            const snap = await getDoc(docRef);
            const historicoAtual = (snap.exists() && snap.data().historicoLotes) ? snap.data().historicoLotes : {};

            historicoAtual[loteInfo.loteId] = {
                loteId: loteInfo.loteId,
                ids: Array.isArray(loteInfo.ids) ? loteInfo.ids : [],
                modo: loteInfo.modo || 'incremental',
                criadoEm: loteInfo.criadoEm || Date.now()
            };

            const chavesOrdenadas = Object.keys(historicoAtual).sort(
                (a, b) => (historicoAtual[b].criadoEm || 0) - (historicoAtual[a].criadoEm || 0)
            );
            const historicoEnxuto = {};
            chavesOrdenadas.slice(0, 10).forEach(k => { historicoEnxuto[k] = historicoAtual[k]; });

            await setDoc(docRef, {
                ultimoLoteId: loteInfo.loteId,
                historicoLotes: historicoEnxuto,
                atualizadoEm: Date.now()
            });
        } catch (e) {
            console.warn("[AcervoManager] Falha não-crítica ao persistir manifesto de lote na nuvem:", e);
        }
    }

    async function carregarManifestoLoteIA(loteIdEspecifico) {
        const uid = getUserId();
        if (!uid || !loteIdEspecifico) return null;

        const modulo = _getModuloAtual();
        const docId = `--CONFIG-LOTE-IA-${modulo}--`;
        const docRef = doc(db, "usuarios", uid, "acervo", docId);

        try {
            const snap = await getDoc(docRef);
            if (!snap.exists()) return null;
            const historico = snap.data().historicoLotes || {};
            return historico[loteIdEspecifico] || null;
        } catch (e) {
            console.warn("[AcervoManager] Falha ao ler manifesto de lote da nuvem:", e);
            return null;
        }
    }

    async function renomearModelosEmLote(listaOperacoes) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        if (!Array.isArray(listaOperacoes) || listaOperacoes.length === 0) return 0;

        const TAMANHO_BATCH = 450; // Cada lote individual de até 450 itens é gravado via writeBatch; listas maiores usam lotes sequenciais
        let totalCommitados = 0;
        const agora = Date.now();

        try {
            for (let i = 0; i < listaOperacoes.length; i += TAMANHO_BATCH) {
                const fatia = listaOperacoes.slice(i, i + TAMANHO_BATCH);
                const batch = writeBatch(db);
                let opsNoBatch = 0;

                fatia.forEach(op => {
                    if (!op || !op.id) return;
                    const docRef = doc(db, "usuarios", uid, "acervo", op.id);
                    const payloadUpdate = { atualizadoEm: agora };

                    if (typeof op.novoNome === 'string' && op.novoNome.trim() !== '') {
                        payloadUpdate.nome = op.novoNome.trim();
                    }
                    if (op.auditoriaIA !== undefined) {
                        payloadUpdate.auditoriaIA = op.auditoriaIA;
                    }

                    batch.update(docRef, payloadUpdate);
                    opsNoBatch++;
                });

                if (opsNoBatch > 0) {
                    await batch.commit();
                    totalCommitados += opsNoBatch;
                }
            }
            return totalCommitados;
        } catch (e) {
            _processarErroFirebase(e, 'renomearModelosEmLote (writeBatch)');
        } finally {
            modelosEmCache = [];
        }
    }

    return { 
        salvarNovoModelo, 
        adicionarNoAModelo, 
        carregarModelos, 
        atualizarNoDoModelo, 
        removerNoDoModelo,
        renomearModelo,
        renomearModelosEmLote,
        definirStatusAuditoriaModelo,
        verificarSeModeloAuditado,
        criarAssinaturaAuditoria,
        salvarManifestoLoteIA,
        carregarManifestoLoteIA,
        excluirModeloCompleto,
        salvarConfigTags,
        carregarConfigTags,
        atualizarTagEmTodosModelos,
        atualizarTagsDoModelo,
        atualizarEscopoDoModelo
    };
})();
