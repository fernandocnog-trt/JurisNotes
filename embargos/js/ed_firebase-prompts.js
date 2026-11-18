/* ================================================
   js/ed_firebase-prompts.js
   Persistência Firestore com Operações Atômicas e Preferências Integradas (V2.1 - Módulo ED)
   ================================================ */
import { app, auth } from './ed_firebase-auth.js'; 
import { getFirestore, collection, doc, setDoc, updateDoc, getDocs, deleteDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const db = getFirestore(app);
const PREFS_DOC_ID = '_prefs_config';

window.FirebasePrompts = (function() {
    let cache = [];
    let prefsCache = null;

    function getUserId() {
        return auth.currentUser ? auth.currentUser.uid : null;
    }

    function _gerarIdSeguro() {
        try {
            return 'prt-' + crypto.randomUUID();
        } catch (e) {
            return 'prt-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
        }
    }

    // Criação/Edição completa com { merge: true } para preservar campos coexistentes
    async function salvar(promptObj) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const id = promptObj.id || _gerarIdSeguro();
        const docRef = doc(db, "usuarios", uid, "prompts", id);
        
        await setDoc(docRef, { ...promptObj, id, atualizadoEm: Date.now() }, { merge: true });
        cache = []; 
        return id;
    }

    // Atualização parcial estrita via updateDoc: se o documento foi excluído, propaga erro para rollback na UI
    async function atualizarCampos(id, camposParciais) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        if (!id || id === PREFS_DOC_ID) return;

        const docRef = doc(db, "usuarios", uid, "prompts", id);
        await updateDoc(docRef, { ...camposParciais, atualizadoEm: Date.now() });
        cache = [];
    }

    // Remoção atômica de um subprompt do array subPromptIds de um prompt pai via arrayRemove()
    async function removerReferenciaSubPrompt(parentId, subId) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        if (!parentId || !subId) return;

        const parentRef = doc(db, "usuarios", uid, "prompts", parentId);
        await updateDoc(parentRef, {
            subPromptIds: arrayRemove(subId),
            atualizadoEm: Date.now()
        });
        cache = [];
    }

    // Carrega todos os modelos e separa o documento de configuração _prefs_config em uma única leitura
    async function carregar(forcarRefresh = false) {
        const uid = getUserId();
        if (!uid) return [];
        if (cache.length > 0 && !forcarRefresh) return cache;

        const snapshot = await getDocs(collection(db, "usuarios", uid, "prompts"));
        const resultados = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (docSnap.id === PREFS_DOC_ID || (data && data.isSystemConfig === true)) {
                prefsCache = data;
            } else if (data && typeof data.title === 'string') {
                resultados.push({ id: docSnap.id, ...data });
            }
        });

        cache = resultados;
        return resultados;
    }
    
    async function excluir(id) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        await deleteDoc(doc(db, "usuarios", uid, "prompts", id));
        cache = [];
    }

    // Salva preferências na coleção 'prompts' com campos sentinela para compatibilidade de schema
    async function salvarPreferencias(prefsObj) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        const prefRef = doc(db, "usuarios", uid, "prompts", PREFS_DOC_ID);
        const payload = {
            title: '__SYSTEM_PREFS__',
            content: '__SYSTEM_PREFS__',
            isSystemConfig: true,
            ...prefsObj,
            atualizadoEm: Date.now()
        };
        await setDoc(prefRef, payload, { merge: true });
        prefsCache = { ...(prefsCache || {}), ...payload };
        return payload;
    }

    function obterPreferenciasCache() {
        return prefsCache;
    }

    return {
        salvar,
        atualizarCampos,
        removerReferenciaSubPrompt,
        carregar,
        excluir,
        salvarPreferencias,
        obterPreferenciasCache
    };
})();
