import { app, auth } from './firebase-auth.js'; 
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const db = getFirestore(app); // Correção do Bug de Instanciação

window.FirebasePrompts = (function() {
    let cache = [];

    function getUserId() {
        return auth.currentUser ? auth.currentUser.uid : null;
    }

    // Fallback Matemático para contornar falhas da Web Crypto em file:// ou http
    function _gerarIdSeguro() {
        try {
            return 'prt-' + crypto.randomUUID();
        } catch (e) {
            return 'prt-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
        }
    }

    async function salvar(promptObj) {
        const uid = getUserId();
        if (!uid) throw new Error("Usuário não autenticado.");
        
        const id = promptObj.id || _gerarIdSeguro();
        const docRef = doc(db, "usuarios", uid, "prompts", id); // Isolamento garantido
        
        await setDoc(docRef, { ...promptObj, atualizadoEm: Date.now() });
        cache = []; 
        return id;
    }

    async function carregar() {
        const uid = getUserId();
        if (!uid) return [];
        if (cache.length > 0) return cache;

        const snapshot = await getDocs(collection(db, "usuarios", uid, "prompts"));
        const resultados = [];
        snapshot.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
        cache = resultados;
        return resultados;
    }
    
    async function excluir(id) {
        const uid = getUserId();
        if (!uid) return;
        await deleteDoc(doc(db, "usuarios", uid, "prompts", id));
        cache = [];
    }

    return { salvar, carregar, excluir };
})();